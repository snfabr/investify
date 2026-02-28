import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { llmGenerate, defaultConfig } from '@/lib/llm'
import { WEEKLY_PLAN_SYSTEM_PROMPT } from '@/lib/llm/prompts'
import { buildPlanContext } from '@/lib/plans/context'
import type { ModelMessage } from 'ai'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

  const context = await buildPlanContext(user.id)

  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: `Please generate a weekly investment plan based on the following context:\n\n${context}\n\nReturn ONLY valid JSON matching the specified schema. No markdown code fences.`,
    },
  ]

  let planJson: Record<string, unknown>
  try {
    const text = await llmGenerate(config, messages, WEEKLY_PLAN_SYSTEM_PROMPT)
    // Strip any markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
    planJson = JSON.parse(cleaned)
  } catch {
    return NextResponse.json({ error: 'Failed to generate or parse plan' }, { status: 500 })
  }

  // Get the Monday of the current week
  const now = new Date()
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  const weekOf = monday.toISOString().split('T')[0]

  const { data: plan, error } = await supabase
    .from('weekly_plans')
    .insert({
      user_id:      user.id,
      week_of:      weekOf,
      plan:         planJson,
      llm_provider: config.provider,
      llm_model:    config.model,
    })
    .select('id')
    .single()

  if (error || !plan) {
    return NextResponse.json({ error: 'Failed to save plan' }, { status: 500 })
  }

  return NextResponse.json({ planId: plan.id, plan: planJson })
}

// Support GET for redirect from dashboard "Generate plan" button
export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/dashboard', request.url))
}
