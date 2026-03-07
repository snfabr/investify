import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { llmStream, defaultConfig } from '@/lib/llm'
import { ACTION_ADVISOR_SYSTEM_PROMPT } from '@/lib/llm/prompts'
import { z } from 'zod'
import type { ModelMessage } from 'ai'

const ActionSchema = z.object({
  messages: z.array(z.object({
    role:    z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional().default([]),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const parsed = ActionSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { messages } = parsed.data

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

  // Fetch current strategy profile. Use limit(1) not single() to avoid failures when
  // multiple is_current=true rows exist (e.g. if the deactivate trigger ever mis-fires).
  const { data: profileRows } = await supabase
    .from('strategy_profiles')
    .select('financial_situation, goals, risk_profile, investment_beliefs, strategy, tactical_framework')
    .eq('user_id', user.id)
    .eq('is_current', true)
    .order('version' as string, { ascending: false })
    .limit(1)
  const profile = profileRows?.[0] ?? null

  // Fetch latest portfolio snapshot
  const { data: snapshotRows } = await supabase
    .from('portfolio_snapshots')
    .select('id, total_value_gbp, cash_gbp, num_holdings, snapshot_date')
    .eq('user_id', user.id)
    .order('snapshot_date', { ascending: false })
    .limit(1)
  const snapshot = snapshotRows?.[0] ?? null

  // Fetch holdings from the most recent snapshot (snapshot_holdings is always populated on import)
  const { data: holdings } = snapshot
    ? await supabase
        .from('snapshot_holdings')
        .select('name, symbol, instrument_type, value_gbp, allocation_pct')
        .eq('snapshot_id', snapshot.id)
        .order('value_gbp', { ascending: false })
        .limit(30)
    : { data: null }

  const fmtGbp = (v: number | null | undefined) =>
    v != null
      ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(v)
      : '—'

  // Build context sections — only include fields that have actual data (non-empty objects)
  function hasData(obj: unknown): boolean {
    return obj != null && typeof obj === 'object' && Object.keys(obj as object).length > 0
  }

  const strategySection = (() => {
    if (!profile) return 'STRATEGY PROFILE: Not yet configured. Ask the user to complete their onboarding at /onboarding.'
    const lines = ['STRATEGY PROFILE:']
    if (hasData(profile.financial_situation)) lines.push(`Financial Situation: ${JSON.stringify(profile.financial_situation, null, 2)}`)
    if (hasData(profile.goals))               lines.push(`Goals: ${JSON.stringify(profile.goals, null, 2)}`)
    if (hasData(profile.risk_profile))        lines.push(`Risk Profile: ${JSON.stringify(profile.risk_profile, null, 2)}`)
    if (hasData(profile.investment_beliefs))  lines.push(`Investment Beliefs: ${JSON.stringify(profile.investment_beliefs, null, 2)}`)
    if (hasData(profile.strategy))            lines.push(`Strategy: ${JSON.stringify(profile.strategy, null, 2)}`)
    if (hasData(profile.tactical_framework))  lines.push(`Tactical Framework: ${JSON.stringify(profile.tactical_framework, null, 2)}`)
    if (lines.length === 1) return 'STRATEGY PROFILE: Saved but all sections are empty. The user should review their strategy at /strategy.'
    return lines.join('\n')
  })()

  const portfolioSection = snapshot
    ? `CURRENT PORTFOLIO (as of ${snapshot.snapshot_date}):
Total value: ${fmtGbp(snapshot.total_value_gbp)} | Cash: ${fmtGbp(snapshot.cash_gbp)} | Holdings: ${snapshot.num_holdings}
${(holdings || [])
  .filter(h => h.instrument_type !== 'cash' && h.value_gbp)
  .map(h => `  - ${h.symbol || h.name}: ${fmtGbp(h.value_gbp)}${h.allocation_pct ? ` (${Number(h.allocation_pct).toFixed(1)}%)` : ''}`)
  .join('\n')}`
    : 'CURRENT PORTFOLIO: No portfolio data imported yet.'

  const systemPrompt = `${ACTION_ADVISOR_SYSTEM_PROMPT}

${strategySection}

${portfolioSection}`

  // For empty messages (first call), add a synthetic user turn to get the greeting
  const coreMessages: ModelMessage[] = messages.length === 0
    ? [{ role: 'user', content: 'Hello, I would like your help planning a portfolio action.' }]
    : messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

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
