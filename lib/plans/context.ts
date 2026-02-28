import { createClient } from '@/lib/supabase/server'

export async function buildPlanContext(userId: string): Promise<string> {
  const supabase = await createClient()

  // 1. Latest portfolio snapshot + holdings
  const { data: snapshot } = await supabase
    .from('portfolio_snapshots')
    .select('*')
    .eq('user_id', userId)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .single()

  const { data: snapshotHoldings } = snapshot
    ? await supabase
        .from('snapshot_holdings')
        .select('*')
        .eq('snapshot_id', snapshot.id)
        .order('value_gbp', { ascending: false })
    : { data: [] }

  // 2. Current strategy profile
  const { data: profile } = await supabase
    .from('strategy_profiles')
    .select('*')
    .eq('user_id', userId)
    .eq('is_current', true)
    .single()

  // 3. Macro indicators (latest per code)
  const { data: macro } = await supabase
    .from('macro_indicators')
    .select('*')
    .order('observation_date', { ascending: false })
    .limit(10)

  // 4. Last 4 weekly plans for continuity
  const { data: recentPlans } = await supabase
    .from('weekly_plans')
    .select('week_of, plan, execution_status')
    .eq('user_id', userId)
    .order('week_of', { ascending: false })
    .limit(4)

  // Build context string
  const lines: string[] = []

  lines.push('=== PORTFOLIO SNAPSHOT ===')
  if (snapshot) {
    lines.push(`As of: ${snapshot.snapshot_date}`)
    lines.push(`Total value: £${snapshot.total_value_gbp.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`)
    lines.push(`Total cost: £${snapshot.total_cost_gbp.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`)
    lines.push(`Unrealised gain/loss: £${snapshot.total_gain_loss_gbp.toLocaleString('en-GB', { maximumFractionDigits: 0 })} (${snapshot.total_gain_loss_pct.toFixed(2)}%)`)
    lines.push(`Cash: £${(snapshot.cash_gbp || 0).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`)
    lines.push(`Holdings: ${snapshot.num_holdings}`)
    lines.push('')
  } else {
    lines.push('No portfolio snapshot available yet.')
    lines.push('')
  }

  lines.push('=== CURRENT HOLDINGS ===')
  if (snapshotHoldings && snapshotHoldings.length > 0) {
    for (const h of snapshotHoldings) {
      lines.push(
        `${h.symbol} | ${h.name} | ${h.instrument_type} | ` +
        `qty: ${h.quantity} | value: £${(h.value_gbp || 0).toLocaleString('en-GB', { maximumFractionDigits: 0 })} | ` +
        `alloc: ${(h.allocation_pct || 0).toFixed(1)}% | ` +
        `gain/loss: ${(h.gain_loss_pct || 0).toFixed(2)}%`
      )
    }
  } else {
    lines.push('No holdings data available.')
  }
  lines.push('')

  lines.push('=== STRATEGY PROFILE ===')
  if (profile) {
    if (profile.financial_situation && Object.keys(profile.financial_situation).length > 0) {
      lines.push('Financial situation:')
      lines.push(JSON.stringify(profile.financial_situation, null, 2))
    }
    if (profile.goals && Object.keys(profile.goals).length > 0) {
      lines.push('Goals:')
      lines.push(JSON.stringify(profile.goals, null, 2))
    }
    if (profile.risk_profile && Object.keys(profile.risk_profile).length > 0) {
      lines.push('Risk profile:')
      lines.push(JSON.stringify(profile.risk_profile, null, 2))
    }
    if (profile.strategy && Object.keys(profile.strategy).length > 0) {
      lines.push('Target strategy:')
      lines.push(JSON.stringify(profile.strategy, null, 2))
    }
    if (profile.tactical_framework && Object.keys(profile.tactical_framework).length > 0) {
      lines.push('Tactical framework:')
      lines.push(JSON.stringify(profile.tactical_framework, null, 2))
    }
  } else {
    lines.push('No strategy profile configured. Advisory onboarding not yet completed.')
  }
  lines.push('')

  lines.push('=== MACRO INDICATORS ===')
  if (macro && macro.length > 0) {
    // Deduplicate: latest per indicator code
    const seen = new Set<string>()
    for (const m of macro) {
      if (!seen.has(m.indicator_code)) {
        seen.add(m.indicator_code)
        lines.push(`${m.indicator_name} (${m.indicator_code}): ${m.value} as of ${m.observation_date}`)
      }
    }
  } else {
    lines.push('No macro indicator data available.')
  }
  lines.push('')

  lines.push('=== RECENT PLANS (last 4 weeks) ===')
  if (recentPlans && recentPlans.length > 0) {
    for (const p of recentPlans) {
      lines.push(`Week of ${p.week_of} — status: ${p.execution_status}`)
      if (p.plan?.week_summary) {
        lines.push(`  Summary: ${p.plan.week_summary}`)
      }
    }
  } else {
    lines.push('No previous plans.')
  }

  return lines.join('\n')
}
