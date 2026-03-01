import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PerformanceView } from '@/components/performance-view'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { Upload } from 'lucide-react'

// ── Daily value reconstruction ────────────────────────────────────────────────

interface SnapshotHolding {
  snapshot_id: string
  symbol: string
  quantity: number
  price_gbp: number
  instrument_type: string
}

interface PricePoint {
  symbol: string
  price_date: string
  close_gbp: number
}

interface SnapshotMeta {
  id: string
  snapshot_date: string
}

function buildDailyValues(
  snapshots: SnapshotMeta[],
  snapshotHoldings: SnapshotHolding[],
  priceHistory: PricePoint[],
): { date: string; estimated_value: number }[] {
  if (snapshots.length === 0 || snapshotHoldings.length === 0) return []

  // 1. id → snapshot_date lookup
  const snapDateById = new Map<string, string>()
  for (const s of snapshots) snapDateById.set(s.id, s.snapshot_date)

  // 2. symbol → date → close_gbp lookup
  const priceMap = new Map<string, Map<string, number>>()
  for (const p of priceHistory) {
    if (!priceMap.has(p.symbol)) priceMap.set(p.symbol, new Map())
    priceMap.get(p.symbol)!.set(p.price_date, p.close_gbp)
  }

  // 3. snapshot_date → holdings lookup (sorted ascending so we can find most recent)
  const snapshotsByDate = new Map<string, SnapshotHolding[]>()
  for (const h of snapshotHoldings) {
    const date = snapDateById.get(h.snapshot_id)
    if (!date) continue
    if (!snapshotsByDate.has(date)) snapshotsByDate.set(date, [])
    snapshotsByDate.get(date)!.push(h)
  }

  // Sorted snapshot dates
  const sortedSnapshotDates = [...snapshotsByDate.keys()].sort()

  // 4. Collect all unique price dates (from price_history)
  const allPriceDates = [...new Set(priceHistory.map(p => p.price_date))].sort()

  if (allPriceDates.length === 0) return []

  // 5. For each price date, find the most recent snapshot ≤ price_date and compute value
  const result: { date: string; estimated_value: number }[] = []

  for (const priceDate of allPriceDates) {
    // Find most recent snapshot on or before this date
    let activeSnapshotDate: string | null = null
    for (const sd of sortedSnapshotDates) {
      if (sd <= priceDate) activeSnapshotDate = sd
      else break
    }
    if (!activeSnapshotDate) continue

    const holdings = snapshotsByDate.get(activeSnapshotDate)!
    let total = 0

    for (const h of holdings) {
      if (h.instrument_type === 'cash') {
        // Cash: use snapshot price directly (quantity=1, price_gbp=value)
        total += h.price_gbp
      } else {
        // Try market price first, fall back to snapshot price
        const marketPrice = priceMap.get(h.symbol)?.get(priceDate)
        const price = marketPrice ?? h.price_gbp
        total += h.quantity * price
      }
    }

    result.push({ date: priceDate, estimated_value: total })
  }

  return result
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function PerformancePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: snapshots }, { data: holdings }] = await Promise.all([
    supabase
      .from('portfolio_snapshots')
      .select('id, snapshot_date, total_value_gbp, total_cost_gbp, total_gain_loss_gbp, total_gain_loss_pct, cash_gbp')
      .eq('user_id', user.id)
      .order('snapshot_date', { ascending: true }),

    supabase
      .from('holdings')
      .select('id, symbol, name, instrument_type, cost_basis_gbp, current_value_gbp, gain_loss_gbp, gain_loss_pct, account_holder')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('gain_loss_gbp', { ascending: false, nullsFirst: false }),
  ])

  if (!snapshots || snapshots.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Performance</h1>
        <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
          <p className="text-muted-foreground">No portfolio data yet. Import a CSV to get started.</p>
          <Button asChild>
            <Link href="/portfolio/import">
              <Upload className="h-4 w-4 mr-2" />
              Import CSV
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  // Fetch snapshot holdings + price history in parallel
  const heldSymbols = [...new Set((holdings ?? []).map(h => h.symbol))]

  const [{ data: snapshotHoldings }, { data: priceHistory }] = await Promise.all([
    supabase
      .from('snapshot_holdings')
      .select('snapshot_id, symbol, quantity, price_gbp, instrument_type')
      .eq('user_id', user.id),

    heldSymbols.length > 0
      ? supabase
          .from('price_history')
          .select('symbol, price_date, close_gbp')
          .in('symbol', heldSymbols)
          .order('price_date', { ascending: true })
      : Promise.resolve({ data: [] }),
  ])

  // Build daily value reconstruction
  const snapshotMeta = snapshots.map(s => ({ id: s.id, snapshot_date: s.snapshot_date }))
  const dailyValues = buildDailyValues(
    snapshotMeta,
    (snapshotHoldings ?? []) as SnapshotHolding[],
    (priceHistory ?? []) as PricePoint[],
  )

  // Strip `id` from snapshots before passing to client component (it's not in the Snapshot type)
  const snapshotsForView = snapshots.map(s => ({
    snapshot_date:        s.snapshot_date,
    total_value_gbp:      s.total_value_gbp,
    total_cost_gbp:       s.total_cost_gbp,
    total_gain_loss_gbp:  s.total_gain_loss_gbp,
    total_gain_loss_pct:  s.total_gain_loss_pct,
    cash_gbp:             s.cash_gbp,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Performance</h1>
        <p className="text-sm text-muted-foreground">
          Based on {snapshots.length} snapshot{snapshots.length !== 1 ? 's' : ''} from{' '}
          {new Date(snapshots[0].snapshot_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          {snapshots.length > 1 && (
            <> to {new Date(snapshots.at(-1)!.snapshot_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</>
          )}
        </p>
      </div>

      <PerformanceView
        snapshots={snapshotsForView}
        holdings={holdings ?? []}
        dailyValues={dailyValues}
      />
    </div>
  )
}
