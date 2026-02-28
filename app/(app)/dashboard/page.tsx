import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Bell, Upload, Brain, Square } from 'lucide-react'

function formatGbp(value: number) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch latest snapshot for portfolio summary
  const { data: snapshot } = await supabase
    .from('portfolio_snapshots')
    .select('*')
    .eq('user_id', user.id)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .single()

  // Fetch current week's plan
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1) // Monday
  const weekOf = weekStart.toISOString().split('T')[0]

  const { data: plan } = await supabase
    .from('weekly_plans')
    .select('*')
    .eq('user_id', user.id)
    .gte('week_of', weekOf)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  // Fetch unread alert count
  const { count: unreadCount } = await supabase
    .from('alerts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('is_read', false)
    .eq('is_dismissed', false)

  const actions = (plan?.plan?.actions || []) as Array<{
    type: string
    symbol: string
    name: string
    amount_gbp?: number
    rationale: string
    priority: string
  }>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/alerts">
              <Bell className="h-4 w-4 mr-2" />
              Alerts
              {(unreadCount || 0) > 0 && (
                <Badge variant="destructive" className="ml-2 h-5 min-w-5 text-xs px-1">
                  {unreadCount}
                </Badge>
              )}
            </Link>
          </Button>
        </div>
      </div>

      {/* Portfolio summary */}
      {snapshot ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">Portfolio value</p>
              <p className="text-xl font-bold">{formatGbp(snapshot.total_value_gbp)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                as of {new Date(snapshot.snapshot_date).toLocaleDateString('en-GB')}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">Total cost</p>
              <p className="text-xl font-bold">{formatGbp(snapshot.total_cost_gbp)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">Unrealised gain</p>
              <p className={`text-xl font-bold ${snapshot.total_gain_loss_gbp >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatGbp(snapshot.total_gain_loss_gbp)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">Return</p>
              <p className={`text-xl font-bold ${snapshot.total_gain_loss_pct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {snapshot.total_gain_loss_pct >= 0 ? '+' : ''}{snapshot.total_gain_loss_pct.toFixed(2)}%
              </p>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6 py-10 text-center">
            <p className="text-muted-foreground mb-4">No portfolio data yet.</p>
            <Button asChild>
              <Link href="/portfolio/import">
                <Upload className="h-4 w-4 mr-2" />
                Import your first CSV
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Weekly plan */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            This week&apos;s plan
            {plan && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                week of {new Date(plan.week_of).toLocaleDateString('en-GB')}
              </span>
            )}
          </CardTitle>
          <Button size="sm" asChild>
            <Link href="/api/plans/generate" prefetch={false}>
              <Brain className="h-4 w-4 mr-2" />
              Generate plan
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {plan ? (
            <div className="space-y-3">
              {plan.plan.week_summary && (
                <p className="text-sm text-muted-foreground border-l-2 pl-3">
                  {plan.plan.week_summary}
                </p>
              )}
              {actions.length > 0 ? (
                <div className="space-y-2">
                  {actions.map((action, i) => (
                    <div key={i} className="flex items-start gap-3 py-2 border-b last:border-0">
                      <Square className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={action.type === 'buy' ? 'default' : 'secondary'}>
                            {action.type.toUpperCase()}
                          </Badge>
                          <span className="font-mono text-sm font-medium">{action.symbol}</span>
                          {action.amount_gbp && (
                            <span className="text-sm text-muted-foreground">
                              {formatGbp(action.amount_gbp)}
                            </span>
                          )}
                          <Badge variant="outline" className="text-xs">{action.priority}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{action.rationale}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No specific actions this week.</p>
              )}
              {plan.plan.market_notes?.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Market notes</p>
                  <ul className="space-y-1">
                    {plan.plan.market_notes.map((note: string, i: number) => (
                      <li key={i} className="text-sm text-muted-foreground">• {note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="py-6 text-center">
              <p className="text-muted-foreground text-sm mb-3">No plan generated for this week yet.</p>
              <p className="text-xs text-muted-foreground">
                Plans are generated automatically every Monday at 7am, or you can generate one manually above.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Disclaimer */}
      <p className="text-xs text-muted-foreground text-center">
        Investify is a personal planning tool, not regulated financial advice. All investment decisions are your own.
      </p>
    </div>
  )
}
