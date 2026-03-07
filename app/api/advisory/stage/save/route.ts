import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { llmGenerate, defaultConfig } from '@/lib/llm'
import { STAGE_EXTRACTION_PROMPTS } from '@/lib/llm/prompts'
import { z } from 'zod'
import type { ModelMessage } from 'ai'

const STAGE_COLUMNS: Record<number, string> = {
  1: 'financial_situation',
  2: 'goals',
  3: 'risk_profile',
  4: 'investment_beliefs',
  5: 'strategy',
  6: 'tactical_framework',
}

const SaveSchema = z.object({
  stage: z.number().int().min(1).max(6),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })),
  profileId:    z.string().uuid().optional(),
  mode:         z.enum(['onboarding', 'edit']).optional().default('onboarding'),
  stageContext: z.string().optional(),  // JSON of existing stage data — used to merge, not overwrite
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const parsed = SaveSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { stage, messages, profileId, mode, stageContext } = parsed.data
  const column = STAGE_COLUMNS[stage]

  // Get user's LLM settings
  const { data: settings } = await supabase
    .from('user_settings')
    .select('llm_provider, llm_model')
    .eq('user_id', user.id)
    .single()

  const config = {
    provider: (settings?.llm_provider || defaultConfig.provider) as typeof defaultConfig.provider,
    model: settings?.llm_model || defaultConfig.model,
  }

  // Parse existing stage data upfront — used as fallback base if extraction fails
  let existingStageData: Record<string, unknown> = {}
  if (stageContext) {
    try {
      existingStageData = JSON.parse(stageContext) as Record<string, unknown>
    } catch { /* ignore */ }
  }

  // Extract structured JSON from conversation using LLM
  const baseExtractionPrompt = STAGE_EXTRACTION_PROMPTS[stage]

  // In edit mode, instruct the LLM to start from existing data and apply only what changed.
  const extractionPrompt = stageContext
    ? `${baseExtractionPrompt}\n\nIMPORTANT: The user already has this saved configuration:\n${stageContext}\nFor any fields NOT explicitly discussed or changed in the conversation, carry forward their existing values — do NOT return null for them.`
    : baseExtractionPrompt

  const coreMessages: ModelMessage[] = [
    ...messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    // Always end with a user turn — Claude does not support assistant prefill
    { role: 'user' as const, content: extractionPrompt },
  ]

  // Start from existing data so extraction failure never wipes good data
  let stageData: Record<string, unknown> = { ...existingStageData }

  if (coreMessages.length > 0) {
    try {
      const extracted = await llmGenerate(config, coreMessages)
      console.log(`[stage/save] stage=${stage} raw extraction:`, extracted.slice(0, 500))
      const jsonMatch = extracted.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const extractedData = JSON.parse(jsonMatch[0]) as Record<string, unknown>
        // Merge: only overwrite fields with non-null extracted values
        for (const [key, value] of Object.entries(extractedData)) {
          if (value !== null && value !== undefined) {
            stageData[key] = value
          }
        }
        console.log(`[stage/save] stage=${stage} merged stageData keys:`, Object.keys(stageData))
      } else {
        console.warn(`[stage/save] stage=${stage} extraction returned no JSON match. Raw:`, extracted.slice(0, 200))
      }
    } catch (err) {
      console.error(`[stage/save] stage=${stage} extraction error:`, err)
      // stageData already contains existingStageData as fallback
    }
  }

  // Fetch current profile — use limit(1)+version desc to avoid .single() failing on multiple
  // is_current=true rows (which can occur if the deactivate trigger ever mis-fires)
  let currentProfile: Record<string, unknown> | null = null
  if (profileId) {
    const { data } = await supabase
      .from('strategy_profiles')
      .select('*')
      .eq('id', profileId)
      .eq('user_id', user.id)
      .limit(1)
    currentProfile = data?.[0] ?? null
  }
  if (!currentProfile) {
    const { data } = await supabase
      .from('strategy_profiles')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .order('version' as string, { ascending: false })
      .limit(1)
    currentProfile = data?.[0] ?? null
  }

  console.log(`[stage/save] stage=${stage} mode=${mode} profileId=${profileId} found=${!!currentProfile} stageDataKeys=${Object.keys(stageData)}`)

  // In edit mode with no current profile, return error rather than creating a bare v1
  // that would overwrite all other stages with null
  if (mode === 'edit' && !currentProfile) {
    return NextResponse.json({ error: 'No current strategy profile found' }, { status: 404 })
  }

  let resultProfileId: string

  if (mode === 'onboarding' || !currentProfile) {
    if (!currentProfile) {
      // Create new profile v1
      const { data, error } = await supabase
        .from('strategy_profiles')
        .insert({
          user_id: user.id,
          version: 1,
          is_current: true,
          completed_stages: [stage],
          [column]: stageData,
        })
        .select('id')
        .single()
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      resultProfileId = data.id
    } else {
      // Update stage column in-place on existing profile
      const existingStages = (currentProfile.completed_stages as number[]) || []
      const completedStages = existingStages.includes(stage)
        ? existingStages
        : [...existingStages, stage]

      const { error } = await supabase
        .from('strategy_profiles')
        .update({
          [column]: stageData,
          completed_stages: completedStages,
          is_complete: completedStages.length >= 6,
        })
        .eq('id', currentProfile.id as string)

      if (error) {
        console.error(`[stage/save] update error:`, error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      console.log(`[stage/save] updated profile ${currentProfile.id} column=${column}`)
      resultProfileId = currentProfile.id as string
    }
  } else {
    // Edit mode: clone current profile as new version
    // The DB trigger deactivate_old_profiles will deactivate the old one on INSERT
    const newVersion = ((currentProfile.version as number) || 1) + 1
    const existingStages = (currentProfile.completed_stages as number[]) || []
    const completedStages = existingStages.includes(stage)
      ? existingStages
      : [...existingStages, stage]

    const { data, error } = await supabase
      .from('strategy_profiles')
      .insert({
        user_id: user.id,
        version: newVersion,
        is_current: true,
        financial_situation: currentProfile.financial_situation,
        goals: currentProfile.goals,
        risk_profile: currentProfile.risk_profile,
        investment_beliefs: currentProfile.investment_beliefs,
        strategy: currentProfile.strategy,
        tactical_framework: currentProfile.tactical_framework,
        completed_stages: completedStages,
        is_complete: completedStages.length >= 6,
        [column]: stageData,
      })
      .select('id')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    resultProfileId = data.id
  }

  return NextResponse.json({ profileId: resultProfileId, stageData })
}
