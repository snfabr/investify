import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PerformanceView } from '@/components/performance-view'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { Upload } from 'lucide-react'

export default async function PerformancePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: snapshots }, { data: holdings }] = await Promise.all([
    supabase
      .from('portfolio_snapshots')
      .select('snapshot_date, total_value_gbp, total_cost_gbp, total_gain_loss_gbp, total_gain_loss_pct, cash_gbp')
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

      <PerformanceView snapshots={snapshots} holdings={holdings ?? []} />
    </div>
  )
}
