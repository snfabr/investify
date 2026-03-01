'use client'

import { useState, useMemo } from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface Snapshot {
  snapshot_date: string
  total_value_gbp: number
  total_cost_gbp: number
  total_gain_loss_gbp: number
  total_gain_loss_pct: number
  cash_gbp: number
}

interface Holding {
  id: string
  symbol: string
  name: string
  instrument_type: string
  cost_basis_gbp: number | null
  current_value_gbp: number | null
  gain_loss_gbp: number | null
  gain_loss_pct: number | null
  account_holder: string
}

interface DailyValue {
  date: string
  estimated_value: number
}

// Unified chart data point — all fields optional so we can merge two series
interface ChartPoint {
  date: string                   // ISO date (canonical key)
  total_value_gbp?: number
  total_cost_gbp?: number
  estimated_value?: number
}

interface Props {
  snapshots: Snapshot[]
  holdings: Holding[]
  dailyValues?: DailyValue[]
}

// ── Formatters ───────────────────────────────────────────────────────────────

function fmt(v: number | null) {
  if (v === null) return '—'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(v)
}

function fmtFull(v: number | null) {
  if (v === null) return '—'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(v)
}

function fmtPct(v: number | null) {
  if (v === null) return '—'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

function fmtDate(iso: string, mode: 'short' | 'long' = 'short') {
  const d = new Date(iso)
  return mode === 'short'
    ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Chart tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null

  const value    = payload.find(p => p.name === 'Portfolio value')?.value
  const cost     = payload.find(p => p.name === 'Invested')?.value
  const estimate = payload.find(p => p.name === 'Daily estimate')?.value

  // Snapshot point
  if (value != null) {
    const gain    = value - (cost ?? 0)
    const gainPct = (cost ?? 0) > 0 ? (gain / (cost ?? 0)) * 100 : 0
    return (
      <div className="bg-background border rounded-lg shadow-lg px-4 py-3 text-sm space-y-1 min-w-48">
        <p className="font-semibold text-muted-foreground">{label ? fmtDate(label, 'long') : ''}</p>
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">Portfolio value</span>
          <span className="font-medium">{fmtFull(value)}</span>
        </div>
        {cost != null && (
          <div className="flex justify-between gap-6">
            <span className="text-muted-foreground">Invested</span>
            <span className="font-medium">{fmtFull(cost)}</span>
          </div>
        )}
        {cost != null && (
          <div className="flex justify-between gap-6 border-t pt-1">
            <span className="text-muted-foreground">Gain / Loss</span>
            <span className={`font-semibold ${gain >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {fmtFull(gain)} ({fmtPct(gainPct)})
            </span>
          </div>
        )}
      </div>
    )
  }

  // Daily-estimate-only point
  if (estimate != null) {
    return (
      <div className="bg-background border rounded-lg shadow-lg px-4 py-3 text-sm space-y-1 min-w-40">
        <p className="font-semibold text-muted-foreground">{label ? fmtDate(label, 'long') : ''}</p>
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">Daily estimate</span>
          <span className="font-medium">{fmtFull(estimate)}</span>
        </div>
      </div>
    )
  }

  return null
}

// ── Time range filter ────────────────────────────────────────────────────────

const RANGES = ['1M', '3M', '6M', '1Y', '2Y', '5Y', 'All'] as const
type Range = typeof RANGES[number]

function filterByRange(snapshots: Snapshot[], range: Range): Snapshot[] {
  if (range === 'All') return snapshots
  const now = new Date()
  const months = range === '1M' ? 1 : range === '3M' ? 3 : range === '6M' ? 6
    : range === '1Y' ? 12 : range === '2Y' ? 24 : 60
  const cutoff = new Date(now.getFullYear(), now.getMonth() - months, now.getDate())
  const filtered = snapshots.filter(s => new Date(s.snapshot_date) >= cutoff)
  return filtered.length > 0 ? filtered : snapshots.slice(-1)
}

function filterDailyByRange(daily: DailyValue[], range: Range): DailyValue[] {
  if (range === 'All') return daily
  const now = new Date()
  const months = range === '1M' ? 1 : range === '3M' ? 3 : range === '6M' ? 6
    : range === '1Y' ? 12 : range === '2Y' ? 24 : 60
  const cutoff = new Date(now.getFullYear(), now.getMonth() - months, now.getDate())
  return daily.filter(d => new Date(d.date) >= cutoff)
}

// ── Merge snapshots + daily values into a unified chart series ───────────────

function mergeChartData(snapshots: Snapshot[], daily: DailyValue[]): ChartPoint[] {
  const map = new Map<string, ChartPoint>()

  // Add daily estimates first
  for (const d of daily) {
    map.set(d.date, { date: d.date, estimated_value: d.estimated_value })
  }

  // Overlay snapshot data (these take priority for their dates)
  for (const s of snapshots) {
    const existing = map.get(s.snapshot_date) ?? { date: s.snapshot_date }
    map.set(s.snapshot_date, {
      ...existing,
      date:            s.snapshot_date,
      total_value_gbp: s.total_value_gbp,
      total_cost_gbp:  s.total_cost_gbp,
    })
  }

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

// ── Main component ───────────────────────────────────────────────────────────

export function PerformanceView({ snapshots, holdings, dailyValues = [] }: Props) {
  const [range, setRange] = useState<Range>('All')
  const [sortDesc, setSortDesc] = useState(true)

  const filteredSnapshots = useMemo(() => filterByRange(snapshots, range), [snapshots, range])
  const filteredDaily     = useMemo(() => filterDailyByRange(dailyValues, range), [dailyValues, range])

  const hasDailyData = filteredDaily.length > 0

  // Merged chart data: use daily view when price history is available
  const chartData = useMemo(
    () => hasDailyData
      ? mergeChartData(filteredSnapshots, filteredDaily)
      : filteredSnapshots.map(s => ({
          date:            s.snapshot_date,
          total_value_gbp: s.total_value_gbp,
          total_cost_gbp:  s.total_cost_gbp,
        })),
    [filteredSnapshots, filteredDaily, hasDailyData]
  )

  const latest   = snapshots.at(-1)
  const earliest = snapshots[0]

  // Annualised return
  const annualised = useMemo(() => {
    if (!latest || !earliest || latest === earliest) return null
    const days = (new Date(latest.snapshot_date).getTime() - new Date(earliest.snapshot_date).getTime())
      / (1000 * 60 * 60 * 24)
    if (days < 30) return null
    const r = (latest.total_value_gbp / earliest.total_value_gbp) - 1
    return (Math.pow(1 + r, 365 / days) - 1) * 100
  }, [latest, earliest])

  const investmentHoldings = holdings.filter(h => h.instrument_type !== 'cash')
  const sorted = [...investmentHoldings].sort((a, b) =>
    sortDesc
      ? (b.gain_loss_gbp ?? 0) - (a.gain_loss_gbp ?? 0)
      : (a.gain_loss_gbp ?? 0) - (b.gain_loss_gbp ?? 0)
  )
  const best  = [...investmentHoldings].sort((a, b) => (b.gain_loss_pct ?? 0) - (a.gain_loss_pct ?? 0))[0]
  const worst = [...investmentHoldings].sort((a, b) => (a.gain_loss_pct ?? 0) - (b.gain_loss_pct ?? 0))[0]

  const totalGain = latest?.total_gain_loss_gbp ?? 0
  const totalPct  = latest?.total_gain_loss_pct ?? 0
  const cashTotal = holdings.filter(h => h.instrument_type === 'cash').reduce((s, h) => s + (h.current_value_gbp ?? 0), 0)

  const accountHolders = [...new Set(holdings.map(h => h.account_holder).filter(Boolean))].sort()
  const multiHolder = accountHolders.length > 1

  // Determine if chart has enough data to render
  const snapshotPoints = chartData.filter(p => p.total_value_gbp != null).length
  const canRenderChart = hasDailyData ? chartData.length >= 2 : snapshotPoints >= 2

  return (
    <div className="space-y-6">

      {/* ── Metric cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Portfolio value</p>
            <p className="text-2xl font-bold">{fmt(latest?.total_value_gbp ?? null)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Cash: {fmt(cashTotal)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total return</p>
            <p className={`text-2xl font-bold ${totalGain >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {fmtPct(totalPct)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{fmtFull(totalGain)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Annualised return</p>
            <p className={`text-2xl font-bold ${(annualised ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {annualised !== null ? fmtPct(annualised) : '—'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {annualised !== null ? 'since first import' : 'need 30+ days of data'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Amount invested</p>
            <p className="text-2xl font-bold">{fmt(latest?.total_cost_gbp ?? null)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {snapshots.length} snapshot{snapshots.length !== 1 ? 's' : ''}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Portfolio value chart ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Portfolio value over time</CardTitle>
            {hasDailyData && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Includes daily estimates from market prices
              </p>
            )}
          </div>
          <div className="flex gap-1">
            {RANGES.map(r => (
              <Button
                key={r}
                size="sm"
                variant={range === r ? 'default' : 'ghost'}
                className="h-7 px-2 text-xs"
                onClick={() => setRange(r)}
              >
                {r}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {!canRenderChart ? (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
              {snapshots.length < 2
                ? 'Import your portfolio regularly to track performance over time.'
                : 'No data in this time range.'}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="gradValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#2563eb" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#9ca3af" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#9ca3af" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  tickFormatter={d => fmtDate(d)}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={v => `£${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend
                  iconType="plainline"
                  wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                />

                {/* Daily estimate line — thin solid blue, no fill */}
                {hasDailyData && (
                  <Line
                    type="monotone"
                    dataKey="estimated_value"
                    name="Daily estimate"
                    stroke="#93c5fd"
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                  />
                )}

                {/* Invested cost baseline */}
                <Area
                  type="monotone"
                  dataKey="total_cost_gbp"
                  name="Invested"
                  stroke="#9ca3af"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  fill="url(#gradCost)"
                  dot={false}
                  connectNulls
                />

                {/* Snapshot portfolio value — dots only at snapshot dates */}
                <Area
                  type="monotone"
                  dataKey="total_value_gbp"
                  name="Portfolio value"
                  stroke="#2563eb"
                  strokeWidth={2}
                  fill="url(#gradValue)"
                  dot={snapshotPoints <= 6}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── Top performers ────────────────────────────────────────────────── */}
      {best && worst && best.symbol !== worst.symbol && (
        <div className="grid grid-cols-2 gap-4">
          <Card className="border-green-200 dark:border-green-900">
            <CardContent className="pt-4 flex items-start gap-3">
              <TrendingUp className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Best performer</p>
                <p className="font-semibold truncate">{best.name}</p>
                <p className="text-green-600 font-bold">{fmtPct(best.gain_loss_pct)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-red-200 dark:border-red-900">
            <CardContent className="pt-4 flex items-start gap-3">
              <TrendingDown className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Worst performer</p>
                <p className="font-semibold truncate">{worst.name}</p>
                <p className="text-red-500 font-bold">{fmtPct(worst.gain_loss_pct)}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Holdings performance table ────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Holdings performance</CardTitle>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1"
            onClick={() => setSortDesc(d => !d)}
          >
            Sort: {sortDesc ? 'Best first' : 'Worst first'}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                {multiHolder && <TableHead>Holder</TableHead>}
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Gain / Loss</TableHead>
                <TableHead className="text-right">Return</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map(h => {
                const pct = h.gain_loss_pct ?? 0
                const Icon = pct > 0 ? TrendingUp : pct < 0 ? TrendingDown : Minus
                return (
                  <TableRow key={h.id}>
                    <TableCell>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate max-w-48">{h.name}</p>
                        <Badge variant="outline" className="font-mono text-xs mt-0.5">{h.symbol}</Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">{h.instrument_type}</Badge>
                    </TableCell>
                    {multiHolder && (
                      <TableCell className="text-sm text-muted-foreground">
                        {h.account_holder?.split(' ')[0] ?? '—'}
                      </TableCell>
                    )}
                    <TableCell className="text-right tabular-nums text-sm">
                      {fmtFull(h.cost_basis_gbp)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">
                      {fmtFull(h.current_value_gbp)}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums text-sm ${
                      (h.gain_loss_gbp ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {fmtFull(h.gain_loss_gbp)}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums text-sm font-semibold ${
                      pct >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      <span className="flex items-center justify-end gap-1">
                        <Icon className="h-3 w-3" />
                        {fmtPct(pct)}
                      </span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
