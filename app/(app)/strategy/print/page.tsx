import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AutoPrint } from '@/components/auto-print'
import { PrintButton } from '@/components/print-button'

function fmtGbp(v: number | null | undefined) {
  if (v == null) return '—'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(v)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function fmtSentence(v: unknown): string {
  if (v == null) return '—'
  const s = String(v).trim()
  if (!s) return '—'
  const c = s.charAt(0).toUpperCase() + s.slice(1)
  return /[.!?]$/.test(c) ? c : c + '.'
}

function fmt(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.length > 0 ? v.join(', ') : '—'
  return String(v)
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8 break-inside-avoid">
      <h2 className="text-base font-bold uppercase tracking-widest border-b-2 border-gray-800 pb-1 mb-4">
        {title}
      </h2>
      {children}
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-4 mb-1.5 text-sm">
      <span className="w-44 flex-shrink-0 text-gray-500 font-medium">{label}</span>
      <span className="flex-1">{value}</span>
    </div>
  )
}

function LongField({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2 text-sm">
      <div className="text-gray-500 font-medium mb-0.5">{label}</div>
      <div className="pl-2">{value}</div>
    </div>
  )
}

export default async function StrategyPrintPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [profileResult, snapshotResult, sessionResult] = await Promise.all([
    supabase
      .from('strategy_profiles')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .order('version' as string, { ascending: false })
      .limit(1),
    supabase
      .from('portfolio_snapshots')
      .select('id, total_value_gbp, cash_gbp, num_holdings, snapshot_date')
      .eq('user_id', user.id)
      .order('snapshot_date', { ascending: false })
      .limit(1),
    supabase
      .from('action_sessions')
      .select('title, created_at, summary, recommendation')
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1),
  ])

  const profile = profileResult.data?.[0]
  if (!profile) redirect('/onboarding')

  const snapshot = snapshotResult.data?.[0] ?? null
  const latestSession = sessionResult.data?.[0] ?? null

  // Fetch holdings for the portfolio table
  const { data: holdings } = snapshot
    ? await supabase
        .from('snapshot_holdings')
        .select('name, symbol, instrument_type, value_gbp, allocation_pct')
        .eq('snapshot_id', snapshot.id)
        .order('value_gbp', { ascending: false })
    : { data: null }

  const fs = (profile.financial_situation ?? {}) as Record<string, unknown>
  const goals = (profile.goals ?? {}) as Record<string, unknown>
  const risk = (profile.risk_profile ?? {}) as Record<string, unknown>
  const beliefs = (profile.investment_beliefs ?? {}) as Record<string, unknown>
  const strategy = (profile.strategy ?? {}) as Record<string, unknown>
  const tactical = (profile.tactical_framework ?? {}) as Record<string, unknown>

  const rec = latestSession?.recommendation as Record<string, unknown> | null
  const nonCashHoldings = (holdings ?? []).filter(h => h.instrument_type !== 'cash')

  const coreHoldings = Array.isArray(strategy.core_holdings) ? strategy.core_holdings as Record<string, unknown>[] : []
  const thematicHoldings = Array.isArray(strategy.thematic_holdings) ? strategy.thematic_holdings as Record<string, unknown>[] : []
  const individualHoldings = Array.isArray(strategy.individual_holdings) ? strategy.individual_holdings as Record<string, unknown>[] : []
  const triggers = Array.isArray(tactical.alert_triggers) ? tactical.alert_triggers as Record<string, unknown>[] : []
  const responses = Array.isArray(tactical.event_responses) ? tactical.event_responses as Record<string, unknown>[] : []
  const themes = Array.isArray(beliefs.thematic_interests) ? beliefs.thematic_interests as string[] : []
  const instruments = Array.isArray(beliefs.preferred_instruments) ? beliefs.preferred_instruments as string[] : []

  return (
    <>
      <AutoPrint />
      <style>{`
        @page { margin: 2cm; size: A4; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .break-inside-avoid { break-inside: avoid; }
          .break-before-page { break-before: page; }
        }
      `}</style>

      <div className="max-w-3xl mx-auto px-6 py-8 font-sans text-gray-900">

        {/* Header */}
        <div className="flex items-start justify-between mb-8 pb-4 border-b-2 border-gray-900">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Investify — Investment Strategy</h1>
            <p className="text-sm text-gray-500 mt-1">
              Version {profile.version} &nbsp;·&nbsp; Generated {fmtDate(new Date().toISOString())}
              {profile.is_complete && ' · Complete'}
            </p>
          </div>
          <PrintButton />
        </div>

        {/* Stage 1: Financial Situation */}
        <Section title="1. Financial Situation">
          {snapshot && (
            <div className="mb-4 bg-gray-50 rounded p-3 text-sm flex gap-8">
              <div><span className="text-gray-500">ISA Value</span><br /><strong>{fmtGbp(snapshot.total_value_gbp)}</strong></div>
              <div><span className="text-gray-500">Cash</span><br /><strong>{fmtGbp(snapshot.cash_gbp)}</strong></div>
              <div><span className="text-gray-500">Holdings</span><br /><strong>{snapshot.num_holdings}</strong></div>
              <div><span className="text-gray-500">As of</span><br /><strong>{fmtDate(snapshot.snapshot_date)}</strong></div>
            </div>
          )}
          {fs.monthly_budget_gbp != null && <Field label="Monthly budget" value={fmtGbp(fs.monthly_budget_gbp as number)} />}
          {fs.income_stability != null && <Field label="Income stability" value={fmt(fs.income_stability)} />}
          {fs.tax_rate != null && <Field label="Tax rate" value={fmt(fs.tax_rate)} />}
          {fs.emergency_fund != null && <Field label="Emergency fund" value={fmt(fs.emergency_fund)} />}
          {fs.pension_exists != null && <Field label="Pension" value={fmt(fs.pension_exists)} />}
          {fs.notes != null && <LongField label="Notes" value={fmtSentence(fs.notes)} />}

          {nonCashHoldings.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Portfolio Holdings</p>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-300">
                    <th className="text-left py-1.5 font-semibold text-gray-600">Holding</th>
                    <th className="text-right py-1.5 font-semibold text-gray-600">Value</th>
                    <th className="text-right py-1.5 font-semibold text-gray-600">Allocation</th>
                  </tr>
                </thead>
                <tbody>
                  {nonCashHoldings.map((h, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-1.5 pr-4">{h.name}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtGbp(h.value_gbp)}</td>
                      <td className="py-1.5 text-right tabular-nums">{h.allocation_pct != null ? `${Number(h.allocation_pct).toFixed(1)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Stage 2: Investment Goals */}
        <Section title="2. Investment Goals">
          {goals.primary_objective != null && <LongField label="Objective" value={fmtSentence(goals.primary_objective)} />}
          {goals.time_horizon_years != null && <Field label="Time horizon" value={`${goals.time_horizon_years} years`} />}
          {goals.target_value_gbp != null && <Field label="Target value" value={fmtGbp(goals.target_value_gbp as number)} />}
          {goals.target_age != null && <Field label="Target age" value={`Age ${goals.target_age}`} />}
          {goals.isa_role != null && <LongField label="ISA role" value={fmtSentence(goals.isa_role)} />}
          {goals.withdrawal_plan != null && <LongField label="Withdrawal plan" value={fmtSentence(goals.withdrawal_plan)} />}
          {goals.notes != null && <LongField label="Notes" value={fmtSentence(goals.notes)} />}
        </Section>

        {/* Stage 3: Risk Profile */}
        <Section title="3. Risk Profile">
          {risk.risk_score != null && <Field label="Risk score" value={`${risk.risk_score}/10`} />}
          {risk.max_drawdown_pct != null && <Field label="Max drawdown" value={`${risk.max_drawdown_pct}%`} />}
          {risk.recovery_patience_years != null && <Field label="Recovery patience" value={`${risk.recovery_patience_years} years`} />}
          {risk.crash_reaction != null && <LongField label="Crash reaction" value={fmtSentence(risk.crash_reaction)} />}
          {risk.concentration_tolerance != null && <LongField label="Concentration tolerance" value={fmtSentence(risk.concentration_tolerance)} />}
          {risk.past_crash_experience != null && <LongField label="Past crash experience" value={fmtSentence(risk.past_crash_experience)} />}
          {risk.notes != null && <LongField label="Notes" value={fmtSentence(risk.notes)} />}
        </Section>

        {/* Stage 4: Investment Beliefs */}
        <Section title="4. Investment Beliefs">
          {beliefs.passive_active_preference != null && <Field label="Approach" value={<span className="capitalize">{fmt(beliefs.passive_active_preference)}</span>} />}
          {beliefs.geographic_bias != null && <Field label="Geographic bias" value={fmt(beliefs.geographic_bias)} />}
          {beliefs.dividend_vs_growth != null && <Field label="Style" value={fmt(beliefs.dividend_vs_growth)} />}
          {themes.length > 0 && <LongField label="Thematic interests" value={themes.join(', ')} />}
          {instruments.length > 0 && <LongField label="Preferred instruments" value={instruments.join(', ')} />}
          {beliefs.notes != null && <LongField label="Notes" value={fmtSentence(beliefs.notes)} />}
        </Section>

        {/* Stage 5: Strategy Construction */}
        <Section title="5. Strategy Construction">
          {(strategy.core_allocation_pct != null || strategy.thematic_allocation_pct != null || strategy.individual_allocation_pct != null) && (
            <Field label="Allocation split" value={[
              strategy.core_allocation_pct != null ? `Core ${strategy.core_allocation_pct}%` : null,
              strategy.thematic_allocation_pct != null ? `Thematic ${strategy.thematic_allocation_pct}%` : null,
              strategy.individual_allocation_pct != null ? `Individual ${strategy.individual_allocation_pct}%` : null,
            ].filter(Boolean).join(' · ')} />
          )}
          {strategy.rebalancing_trigger_pct != null && <Field label="Rebalancing trigger" value={`±${strategy.rebalancing_trigger_pct}% drift`} />}
          {strategy.max_position_pct != null && <Field label="Max position size" value={`${strategy.max_position_pct}%`} />}
          {strategy.cash_strategy != null && <LongField label="Cash strategy" value={fmtSentence(strategy.cash_strategy)} />}

          {[{ label: 'Core Holdings', items: coreHoldings }, { label: 'Thematic Holdings', items: thematicHoldings }, { label: 'Individual Holdings', items: individualHoldings }]
            .filter(g => g.items.length > 0)
            .map(g => (
              <div key={g.label} className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">{g.label}</p>
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-gray-300">
                      <th className="text-left py-1 font-semibold text-gray-600">Name</th>
                      <th className="text-left py-1 font-semibold text-gray-600">Symbol</th>
                      <th className="text-right py-1 font-semibold text-gray-600">Target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((h, i) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="py-1 pr-4">{String(h.name || '—')}</td>
                        <td className="py-1 pr-4 font-mono text-xs">{String(h.symbol || '—')}</td>
                        <td className="py-1 text-right">{h.target_pct != null ? `${h.target_pct}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          {strategy.notes != null && <LongField label="Notes" value={fmtSentence(strategy.notes)} />}
        </Section>

        {/* Stage 6: Tactical Framework */}
        <Section title="6. Tactical Framework">
          {tactical.immediate_action_threshold_pct != null && <Field label="Action threshold" value={`${tactical.immediate_action_threshold_pct}% portfolio move`} />}
          {tactical.stop_loss_philosophy != null && <LongField label="Stop-loss philosophy" value={fmtSentence(tactical.stop_loss_philosophy)} />}
          {tactical.profit_taking_rules != null && <LongField label="Profit-taking rules" value={fmtSentence(tactical.profit_taking_rules)} />}

          {triggers.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Alert Triggers</p>
              <div className="space-y-2">
                {triggers.map((t, i) => (
                  <div key={i} className="text-sm">
                    <span className="font-medium">{String(t.event_type || `Trigger ${i + 1}`)}: </span>
                    <span>{fmtSentence(t.description)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {responses.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Event Responses</p>
              <div className="space-y-2">
                {responses.map((r, i) => (
                  <div key={i} className="text-sm">
                    <span className="font-medium">{String(r.event_type || `Response ${i + 1}`)}: </span>
                    <span>{fmtSentence(r.response)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {tactical.notes != null && <LongField label="Notes" value={fmtSentence(tactical.notes)} />}
        </Section>

        {/* Most Recent Action */}
        {latestSession && rec && (
          <Section title="Most Recent Advisory Session">
            <div className="mb-3">
              <p className="font-semibold text-base">{latestSession.title}</p>
              <p className="text-sm text-gray-500">{fmtDate(latestSession.created_at)}</p>
              {latestSession.summary && <p className="text-sm mt-1">{fmtSentence(latestSession.summary)}</p>}
            </div>

            {rec.analysis != null && <LongField label="Analysis" value={fmtSentence(rec.analysis)} />}

            {Array.isArray(rec.recommended_actions) && (rec.recommended_actions as Record<string, unknown>[]).length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Recommended Actions</p>
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-gray-300">
                      <th className="text-left py-1.5 font-semibold text-gray-600">Action</th>
                      <th className="text-left py-1.5 font-semibold text-gray-600">Symbol</th>
                      <th className="text-left py-1.5 font-semibold text-gray-600">Rationale</th>
                      <th className="text-right py-1.5 font-semibold text-gray-600">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(rec.recommended_actions as Record<string, unknown>[]).map((a, i) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="py-1.5 pr-3 font-medium capitalize">{String(a.action || '—')}</td>
                        <td className="py-1.5 pr-3 font-mono text-xs">{String(a.symbol || '—')}</td>
                        <td className="py-1.5 pr-3">{String(a.rationale || '—')}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {a.amount_gbp ? fmtGbp(a.amount_gbp as number) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {rec.risks != null && <LongField label="Risks" value={fmtSentence(rec.risks)} />}
            {rec.next_steps != null && <LongField label="Next steps" value={fmtSentence(rec.next_steps)} />}
          </Section>
        )}

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-gray-200 text-xs text-gray-400">
          Generated by Investify on {fmtDate(new Date().toISOString())} · This is not regulated financial advice. This document is a personal planning tool only.
        </div>
      </div>
    </>
  )
}
