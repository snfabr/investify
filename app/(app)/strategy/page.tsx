import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { StrategyView } from '@/components/strategy-view'

export default async function StrategyPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch all versions ordered newest first
  const { data: profiles } = await supabase
    .from('strategy_profiles')
    .select('*')
    .eq('user_id', user.id)
    .order('version', { ascending: false })

  const currentProfile = profiles?.find(p => p.is_current) ?? null

  // No profile → send to onboarding
  if (!currentProfile) {
    redirect('/onboarding')
  }

  // Fetch latest portfolio snapshot for Stage 1 live values
  const { data: latestSnapshot } = await supabase
    .from('portfolio_snapshots')
    .select('id, total_value_gbp, cash_gbp, num_holdings, snapshot_date')
    .eq('user_id', user.id)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .single()

  // Fetch holdings from latest snapshot for portfolio table
  const { data: holdings } = latestSnapshot
    ? await supabase
        .from('snapshot_holdings')
        .select('name, symbol, instrument_type, value_gbp, allocation_pct, account_holder')
        .eq('snapshot_id', latestSnapshot.id)
        .order('value_gbp', { ascending: false })
    : { data: null }

  return (
    <StrategyView
      currentProfile={currentProfile}
      allVersions={profiles ?? []}
      latestSnapshot={latestSnapshot ?? null}
      holdings={holdings ?? []}
    />
  )
}
