import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { llmStream, defaultConfig } from '@/lib/llm'
import { ADVISORY_STAGE_PROMPTS, getStageEditBriefingPrompt } from '@/lib/llm/prompts'
import { z } from 'zod'
import type { ModelMessage } from 'ai'

const ChatSchema = z.object({
  messages: z.array(z.object({
    role:    z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional().default([]),
  stage:        z.number().int().min(1).max(6),
  profileId:    z.string().uuid().optional(),
  mode:               z.enum(['onboarding', 'edit']).optional().default('onboarding'),
  stageContext:       z.string().optional(),
  fullProfileContext: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const parsed = ChatSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { messages, stage, profileId, mode, stageContext, fullProfileContext } = parsed.data

  // Get user's LLM settings
  const { data: settings } = await supabase
    .from('user_settings')
    .select('llm_provider, llm_model')
    .eq('user_id', user.id)
    .single()

  const config = {
    provider: (settings?.llm_provider || defaultConfig.provider) as typeof defaultConfig.provider,
    model:    settings?.llm_model || defaultConfig.model,
  }

  // Build system prompt
  let systemPrompt: string

  if (mode === 'edit' && stageContext) {
    systemPrompt = getStageEditBriefingPrompt(stage, stageContext, fullProfileContext)
  } else {
    systemPrompt = ADVISORY_STAGE_PROMPTS[stage]
  }

  if (!systemPrompt) {
    return NextResponse.json({ error: `Invalid stage: ${stage}` }, { status: 400 })
  }

  // Stage 1 + 5: inject portfolio context into system prompt
  if (stage === 1 || stage === 5) {
    const { data: snapshot } = await supabase
      .from('portfolio_snapshots')
      .select('total_value_gbp, cash_gbp, num_holdings, snapshot_date')
      .eq('user_id', user.id)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .single()

    const { data: holdings } = await supabase
      .from('holdings')
      .select('name, instrument_type, current_value_gbp')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('current_value_gbp', { ascending: false })
      .limit(20)

    if (snapshot) {
      const fmtGbp = (v: number) =>
        new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(v)

      const holdingLines = (holdings || [])
        .filter(h => h.instrument_type !== 'cash' && h.current_value_gbp)
        .map(h => `  - ${h.name}: ${fmtGbp(h.current_value_gbp)}`)
        .join('\n')

      const stage1Instruction = `Use this data as the starting point for Stage 1. Reference these figures when asking about their ISA value. Ask about anything not yet covered (monthly budget, income stability, emergency fund, tax rate, pension).`
      const stage5Instruction = `Use this data as the baseline for strategy construction. Reference these holdings when suggesting target allocations, gaps to fill, and positions to consolidate or exit.`

      const portfolioContext = `\n\nPORTFOLIO DATA (imported on ${snapshot.snapshot_date}):
- ISA total value: ${fmtGbp(snapshot.total_value_gbp)}
- Cash available: ${fmtGbp(snapshot.cash_gbp || 0)}
- Number of holdings: ${snapshot.num_holdings}
${holdingLines ? `Current holdings:\n${holdingLines}` : ''}

${stage === 5 ? stage5Instruction : stage1Instruction}`

      systemPrompt = systemPrompt + portfolioContext
    }
  }

  // Build messages array — for edit mode with empty messages, add a synthetic user turn
  let coreMessages: ModelMessage[] = messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  if (mode === 'edit' && coreMessages.length === 0) {
    coreMessages = [{ role: 'user', content: 'Please review my configuration.' }]
  }

  // Save the last user message to DB (skip synthetic edit-mode opener)
  const isRealUserMessage = !(mode === 'edit' && messages.length === 0)
  const lastUserMsg = [...coreMessages].reverse().find(m => m.role === 'user')
  if (lastUserMsg && isRealUserMessage) {
    await supabase.from('advisory_chat').insert({
      user_id:    user.id,
      profile_id: profileId || null,
      role:       'user',
      content:    typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content),
      stage,
    })
  }

  // Stream the response
  const result = llmStream(config, coreMessages, systemPrompt)

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      for await (const chunk of result.textStream) {
        controller.enqueue(encoder.encode(`0:${JSON.stringify(chunk)}\n`))
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Vercel-AI-Data-Stream': 'v1',
    },
  })
}
