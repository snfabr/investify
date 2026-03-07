'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Pencil, RotateCcw, CheckCircle, Circle, Download } from 'lucide-react'
import { StageEditModal } from '@/components/stage-edit-modal'

interface StrategyProfile {
  id: string
  version: number
  is_current: boolean
  completed_stages: number[]
  is_complete: boolean
  financial_situation: Record<string, unknown>
  goals: Record<string, unknown>
  risk_profile: Record<string, unknown>
  investment_beliefs: Record<string, unknown>
  strategy: Record<string, unknown>
  tactical_framework: Record<string, unknown>
  created_at: string
}

interface LatestSnapshot {
  id: string
  total_value_gbp: number
  cash_gbp: number
  num_holdings: number
  snapshot_date: string
}

interface SnapshotHolding {
  name: string
  symbol: string
  instrument_type: string
  value_gbp: number
  allocation_pct: number | null
  account_holder: string
}

interface StrategyViewProps {
  currentProfile: StrategyProfile
  allVersions: StrategyProfile[]
  latestSnapshot?: LatestSnapshot | null
  holdings?: SnapshotHolding[]
}

const STAGE_META = [
  { id: 1, title: 'Financial Situation', column: 'financial_situation' as const,
    description: 'Your current financial position, ISA value, and budget.' },
  { id: 2, title: 'Investment Goals', column: 'goals' as const,
    description: 'Your objectives, time horizon, and target outcomes.' },
  { id: 3, title: 'Risk Profile', column: 'risk_profile' as const,
    description: 'Your true risk tolerance and drawdown limits.' },
  { id: 4, title: 'Investment Beliefs', column: 'investment_beliefs' as const,
    description: 'Your philosophy on passive/active, themes, and instruments.' },
  { id: 5, title: 'Strategy Construction', column: 'strategy' as const,
    description: 'Your target portfolio allocation and holdings framework.' },
  { id: 6, title: 'Tactical Framework', column: 'tactical_framework' as const,
    description: 'Your alert triggers and event response rules.' },
]

function fmt(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return value.toString()
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—'
  return String(value)
}

/** Capitalise first letter and ensure the string ends with a full stop. */
function fmtSentence(value: unknown): string {
  const s = fmt(value)
  if (s === '—' || s.length === 0) return s
  const capitalised = s.charAt(0).toUpperCase() + s.slice(1)
  return /[.!?]$/.test(capitalised) ? capitalised : capitalised + '.'
}

function fmtGbp(value: unknown): string {
  if (value === null || value === undefined) return '—'
  const n = Number(value)
  if (isNaN(n)) return '—'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n)
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground flex-shrink-0">{label}</dt>
      <dd className="font-medium text-right">{value}</dd>
    </div>
  )
}

function StackedRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}

function HoldingsList({ label, holdings }: { label: string; holdings: unknown[] }) {
  if (holdings.length === 0) return null
  return (
    <div className="mt-1">
      <dt className="text-muted-foreground text-xs font-medium uppercase tracking-wide mb-1">{label}</dt>
      <div className="space-y-0.5 pl-1">
        {holdings.map((h, i) => {
          const holding = h as Record<string, unknown>
          return (
            <div key={i} className="flex justify-between text-xs">
              <span>{String(holding.name || holding.symbol || '—')}</span>
              <span className="font-medium ml-2 flex-shrink-0">
                {holding.target_pct != null ? `${holding.target_pct}%` : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StageCardSummary({
  stageId,
  data,
  latestSnapshot,
  holdings,
}: {
  stageId: number
  data: Record<string, unknown>
  latestSnapshot?: LatestSnapshot | null
  holdings?: SnapshotHolding[]
}) {
  const isEmpty = Object.keys(data).length === 0

  if (stageId === 1) {
    const hasSnapshot = !!latestSnapshot
    if (isEmpty && !hasSnapshot) return <p className="text-sm text-muted-foreground italic">Not configured</p>
    return (
      <dl className="space-y-1 text-sm">
        {hasSnapshot && (
          <>
            <div className="flex justify-between items-center">
              <dt className="text-muted-foreground flex items-center gap-1">ISA value <Badge variant="secondary" className="text-xs px-1 py-0 h-4 text-green-600">Live</Badge></dt>
              <dd className="font-medium">{fmtGbp(latestSnapshot!.total_value_gbp)}</dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-muted-foreground flex items-center gap-1">Cash <Badge variant="secondary" className="text-xs px-1 py-0 h-4 text-green-600">Live</Badge></dt>
              <dd className="font-medium">{fmtGbp(latestSnapshot!.cash_gbp)}</dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-muted-foreground flex items-center gap-1">Holdings <Badge variant="secondary" className="text-xs px-1 py-0 h-4 text-green-600">Live</Badge></dt>
              <dd className="font-medium">{latestSnapshot!.num_holdings}</dd>
            </div>
          </>
        )}
        {!isEmpty && (
          <>
            {data.monthly_budget_gbp != null && <Row label="Monthly budget" value={fmtGbp(data.monthly_budget_gbp)} />}
            {data.income_stability != null && <Row label="Income stability" value={fmt(data.income_stability)} />}
            {data.tax_rate != null && <Row label="Tax rate" value={fmt(data.tax_rate)} />}
            {data.emergency_fund != null && <Row label="Emergency fund" value={fmt(data.emergency_fund)} />}
            {data.pension_exists != null && <Row label="Pension" value={fmt(data.pension_exists)} />}
            {data.notes != null && <StackedRow label="Notes" value={fmtSentence(data.notes)} />}
          </>
        )}
        {/* Portfolio holdings table */}
        {holdings && holdings.filter(h => h.instrument_type !== 'cash').length > 0 && (
          <div className="mt-3">
            <dt className="text-muted-foreground text-xs font-medium uppercase tracking-wide mb-1">Portfolio Holdings</dt>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-1 font-medium text-muted-foreground">Holding</th>
                  <th className="text-right py-1 font-medium text-muted-foreground">Value</th>
                  <th className="text-right py-1 font-medium text-muted-foreground">Alloc.</th>
                </tr>
              </thead>
              <tbody>
                {holdings.filter(h => h.instrument_type !== 'cash').map((h, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1 pr-2">{h.name}</td>
                    <td className="py-1 text-right font-medium tabular-nums">{fmtGbp(h.value_gbp)}</td>
                    <td className="py-1 text-right tabular-nums">{h.allocation_pct != null ? `${Number(h.allocation_pct).toFixed(1)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {isEmpty && hasSnapshot && (
          <p className="text-xs text-muted-foreground mt-1">
            Portfolio data from {new Date(latestSnapshot!.snapshot_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        )}
      </dl>
    )
  }

  if (isEmpty) return <p className="text-sm text-muted-foreground italic">Not configured</p>

  if (stageId === 2) {
    return (
      <dl className="space-y-1 text-sm">
        {data.primary_objective != null && <StackedRow label="Objective" value={fmtSentence(data.primary_objective)} />}
        {data.time_horizon_years != null && <Row label="Time horizon" value={`${data.time_horizon_years} years`} />}
        {data.target_value_gbp != null && <Row label="Target value" value={fmtGbp(data.target_value_gbp)} />}
        {data.target_age != null && <Row label="Target age" value={`Age ${data.target_age}`} />}
        {data.isa_role != null && <StackedRow label="ISA role" value={fmtSentence(data.isa_role)} />}
        {data.withdrawal_plan != null && <StackedRow label="Withdrawal plan" value={fmtSentence(data.withdrawal_plan)} />}
        {data.notes != null && <StackedRow label="Notes" value={fmtSentence(data.notes)} />}
      </dl>
    )
  }

  if (stageId === 3) {
    return (
      <dl className="space-y-1 text-sm">
        {data.risk_score != null && <Row label="Risk score" value={`${data.risk_score}/10`} />}
        {data.max_drawdown_pct != null && <Row label="Max drawdown" value={`${data.max_drawdown_pct}%`} />}
        {data.crash_reaction != null && <StackedRow label="Crash reaction" value={fmtSentence(data.crash_reaction)} />}
        {data.recovery_patience_years != null && <Row label="Recovery patience" value={`${data.recovery_patience_years} years`} />}
        {data.concentration_tolerance != null && <StackedRow label="Concentration tolerance" value={fmtSentence(data.concentration_tolerance)} />}
        {data.past_crash_experience != null && <StackedRow label="Past crash experience" value={fmtSentence(data.past_crash_experience)} />}
        {data.notes != null && <StackedRow label="Notes" value={fmtSentence(data.notes)} />}
      </dl>
    )
  }

  if (stageId === 4) {
    const themes = Array.isArray(data.thematic_interests) ? data.thematic_interests as string[] : []
    const instruments = Array.isArray(data.preferred_instruments) ? data.preferred_instruments as string[] : []
    const esg = Array.isArray(data.esg_screens) ? data.esg_screens as string[] : []
    return (
      <dl className="space-y-1 text-sm">
        {data.passive_active_preference != null && <Row label="Approach" value={<span className="capitalize">{fmt(data.passive_active_preference)}</span>} />}
        {data.geographic_bias != null && <Row label="Geographic bias" value={fmt(data.geographic_bias)} />}
        {data.dividend_vs_growth != null && <Row label="Style" value={fmt(data.dividend_vs_growth)} />}
        {themes.length > 0 && <StackedRow label="Thematic interests" value={themes.join(', ')} />}
        {instruments.length > 0 && <StackedRow label="Preferred instruments" value={instruments.join(', ')} />}
        {esg.length > 0 && <StackedRow label="ESG screens" value={esg.join(', ')} />}
        {data.notes != null && <StackedRow label="Notes" value={fmtSentence(data.notes)} />}
      </dl>
    )
  }

  if (stageId === 5) {
    const coreHoldings = Array.isArray(data.core_holdings) ? data.core_holdings as unknown[] : []
    const thematicHoldings = Array.isArray(data.thematic_holdings) ? data.thematic_holdings as unknown[] : []
    const individualHoldings = Array.isArray(data.individual_holdings) ? data.individual_holdings as unknown[] : []
    const hasAllocations = data.core_allocation_pct != null || data.thematic_allocation_pct != null || data.individual_allocation_pct != null
    return (
      <dl className="space-y-1.5 text-sm">
        {hasAllocations && (
          <Row
            label="Allocation split"
            value={[
              data.core_allocation_pct != null ? `Core ${data.core_allocation_pct}%` : null,
              data.thematic_allocation_pct != null ? `Thematic ${data.thematic_allocation_pct}%` : null,
              data.individual_allocation_pct != null ? `Individual ${data.individual_allocation_pct}%` : null,
            ].filter(Boolean).join(' · ')}
          />
        )}
        {data.rebalancing_trigger_pct != null && <Row label="Rebalancing trigger" value={`±${data.rebalancing_trigger_pct}% drift`} />}
        {data.max_position_pct != null && <Row label="Max position size" value={`${data.max_position_pct}%`} />}
        {data.cash_strategy != null && <StackedRow label="Cash strategy" value={fmtSentence(data.cash_strategy)} />}
        <HoldingsList label="Core holdings" holdings={coreHoldings} />
        <HoldingsList label="Thematic holdings" holdings={thematicHoldings} />
        <HoldingsList label="Individual holdings" holdings={individualHoldings} />
        {data.notes != null && <StackedRow label="Notes" value={fmt(data.notes)} />}
      </dl>
    )
  }

  if (stageId === 6) {
    const triggers = Array.isArray(data.alert_triggers) ? data.alert_triggers as Record<string, unknown>[] : []
    const responses = Array.isArray(data.event_responses) ? data.event_responses as Record<string, unknown>[] : []
    return (
      <dl className="space-y-1.5 text-sm">
        {data.immediate_action_threshold_pct != null && <Row label="Action threshold" value={`${data.immediate_action_threshold_pct}% move`} />}
        {data.stop_loss_philosophy != null && <StackedRow label="Stop-loss" value={fmtSentence(data.stop_loss_philosophy)} />}
        {data.profit_taking_rules != null && <StackedRow label="Profit-taking" value={fmtSentence(data.profit_taking_rules)} />}
        {triggers.length > 0 && (
          <div className="mt-1">
            <dt className="text-muted-foreground text-xs font-medium uppercase tracking-wide mb-1">Alert Triggers</dt>
            <div className="space-y-1.5 pl-1">
              {triggers.map((t, i) => (
                <div key={i} className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium">{String(t.event_type || `Trigger ${i + 1}`)}</span>
                  <span className="text-xs text-muted-foreground">{String(t.description || '—')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {responses.length > 0 && (
          <div className="mt-1">
            <dt className="text-muted-foreground text-xs font-medium uppercase tracking-wide mb-1">Event Responses</dt>
            <div className="space-y-1.5 pl-1">
              {responses.map((r, i) => (
                <div key={i} className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium">{String(r.event_type || `Response ${i + 1}`)}</span>
                  <span className="text-xs text-muted-foreground">{String(r.response || '—')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {data.notes != null && <StackedRow label="Notes" value={fmt(data.notes)} />}
      </dl>
    )
  }

  return null
}

export function StrategyView({ currentProfile, allVersions, latestSnapshot, holdings }: StrategyViewProps) {
  const router = useRouter()
  const [editingStage, setEditingStage] = useState<number | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  async function handleRestore(profileId: string) {
    setRestoring(profileId)
    setRestoreError(null)
    try {
      const res = await fetch('/api/strategy/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error || 'Restore failed')
      }
      router.refresh()
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Restore failed')
    } finally {
      setRestoring(null)
    }
  }

  const editingMeta = editingStage ? STAGE_META.find(s => s.id === editingStage) : null

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          aside, nav, header, [data-print-hide] { display: none !important; }
          [data-print-show] { display: block !important; }
          body, html { background: white !important; }
          .print-section { page-break-inside: avoid; margin-bottom: 1.5rem; }
          .print-footer { margin-top: 2rem; font-size: 0.75rem; color: #666; border-top: 1px solid #ddd; padding-top: 0.5rem; }
        }
      `}</style>

      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Investment Strategy</h1>
            <p className="text-muted-foreground">
              Your personalised strategy profile — version {currentProfile.version}
              {currentProfile.is_complete && (
                <Badge variant="secondary" className="ml-2 text-green-600">Complete</Badge>
              )}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open('/strategy/print', '_blank')}
            data-print-hide
          >
            <Download className="h-4 w-4 mr-2" />
            Download Strategy
          </Button>
        </div>

        {/* Print header (hidden on screen) */}
        <div className="hidden print:block mb-6">
          <h1 className="text-2xl font-bold">Investify — Investment Strategy</h1>
          <p className="text-muted-foreground">Version {currentProfile.version} · {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>

        {/* Stage cards grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:grid-cols-1">
          {STAGE_META.map((stage) => {
            const data = currentProfile[stage.column] as Record<string, unknown>
            const isConfigured = Object.keys(data).length > 0
            const isCompleted = currentProfile.completed_stages?.includes(stage.id)

            return (
              <Card key={stage.id} className="print-section">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {isCompleted
                        ? <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                        : <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      }
                      <div>
                        <CardTitle className="text-sm font-semibold leading-tight">
                          Stage {stage.id}: {stage.title}
                        </CardTitle>
                        <CardDescription className="text-xs mt-0.5">{stage.description}</CardDescription>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 flex-shrink-0 print:hidden"
                      data-print-hide
                      onClick={() => setEditingStage(stage.id)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <StageCardSummary
                    stageId={stage.id}
                    data={isConfigured ? data : {}}
                    latestSnapshot={stage.id === 1 ? latestSnapshot : undefined}
                    holdings={stage.id === 1 ? holdings : undefined}
                  />
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* Version history */}
        {allVersions.length > 1 && (
          <div data-print-hide>
            <h2 className="text-lg font-semibold mb-3">Version History</h2>
            {restoreError && (
              <div className="mb-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{restoreError}</div>
            )}
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Version</th>
                    <th className="text-left px-4 py-2 font-medium">Created</th>
                    <th className="text-left px-4 py-2 font-medium">Stages</th>
                    <th className="text-left px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {allVersions.map((v) => (
                    <tr key={v.id} className={v.is_current ? 'bg-accent/30' : 'hover:bg-muted/30'}>
                      <td className="px-4 py-2">v{v.version}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {new Date(v.created_at).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </td>
                      <td className="px-4 py-2">{(v.completed_stages || []).length} / 6</td>
                      <td className="px-4 py-2">
                        {v.is_current
                          ? <Badge variant="secondary" className="text-green-600">Current</Badge>
                          : <Badge variant="outline" className="text-muted-foreground">Past</Badge>
                        }
                      </td>
                      <td className="px-4 py-2 text-right">
                        {!v.is_current && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            disabled={restoring === v.id}
                            onClick={() => handleRestore(v.id)}
                          >
                            <RotateCcw className="h-3.5 w-3.5 mr-1" />
                            Restore
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Print footer */}
        <div className="hidden print:block print-footer">
          Generated by Investify · {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · Not financial advice.
        </div>

        {/* Edit modal */}
        {editingMeta && (
          <StageEditModal
            stageId={editingMeta.id}
            stageTitle={editingMeta.title}
            profileId={currentProfile.id}
            existingData={currentProfile[editingMeta.column] as Record<string, unknown>}
            fullProfileContext={{
              financial_situation: currentProfile.financial_situation,
              goals: currentProfile.goals,
              risk_profile: currentProfile.risk_profile,
              investment_beliefs: currentProfile.investment_beliefs,
              strategy: currentProfile.strategy,
              tactical_framework: currentProfile.tactical_framework,
            }}
            isOpen={editingStage !== null}
            onClose={() => setEditingStage(null)}
            onSaved={() => {
              setEditingStage(null)
              router.refresh()
            }}
          />
        )}
      </div>
    </>
  )
}
