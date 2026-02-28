import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Upload } from 'lucide-react'
import { AllocationChart } from '@/components/allocation-chart'

function formatGbp(value: number | null) {
  if (value === null) return '—'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
}

function formatPct(value: number | null) {
  if (value === null) return '—'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

export default async function PortfolioPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: holdings } = await supabase
    .from('holdings')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('current_value_gbp', { ascending: false })

  const { data: lastImport } = await supabase
    .from('csv_imports')
    .select('created_at, filename')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const totalValue = holdings?.reduce((sum, h) => sum + (h.current_value_gbp || 0), 0) || 0
  const totalCost  = holdings?.reduce((sum, h) => sum + (h.cost_basis_gbp || 0), 0) || 0
  const totalGain  = totalValue - totalCost
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0

  const chartData = (holdings || [])
    .filter(h => (h.current_value_gbp || 0) > 0)
    .map(h => ({
      name: h.symbol,
      value: h.current_value_gbp || 0,
      pct: totalValue > 0 ? ((h.current_value_gbp || 0) / totalValue) * 100 : 0,
    }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Portfolio</h1>
          {lastImport && (
            <p className="text-sm text-muted-foreground">
              Last import: {new Date(lastImport.created_at).toLocaleDateString('en-GB')} ({lastImport.filename})
            </p>
          )}
        </div>
        <Button asChild>
          <Link href="/portfolio/import">
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Link>
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total value</p>
            <p className="text-2xl font-bold">{formatGbp(totalValue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total cost</p>
            <p className="text-2xl font-bold">{formatGbp(totalCost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Unrealised gain/loss</p>
            <p className={`text-2xl font-bold ${totalGain >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatGbp(totalGain)} ({formatPct(totalGainPct)})
            </p>
          </CardContent>
        </Card>
      </div>

      {holdings && holdings.length > 0 ? (
        <div className="grid grid-cols-3 gap-6">
          {/* Allocation chart */}
          <Card className="col-span-1">
            <CardHeader>
              <CardTitle className="text-base">Allocation</CardTitle>
            </CardHeader>
            <CardContent>
              <AllocationChart data={chartData} />
            </CardContent>
          </Card>

          {/* Holdings table */}
          <Card className="col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Holdings ({holdings.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Alloc %</TableHead>
                    <TableHead className="text-right">Gain/Loss</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holdings.map((h) => {
                    const allocPct = totalValue > 0 ? ((h.current_value_gbp || 0) / totalValue) * 100 : 0
                    return (
                      <TableRow key={h.id}>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">{h.symbol}</Badge>
                        </TableCell>
                        <TableCell className="max-w-40 truncate text-sm">{h.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">{h.instrument_type}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {formatGbp(h.current_value_gbp)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {allocPct.toFixed(1)}%
                        </TableCell>
                        <TableCell className={`text-right tabular-nums text-sm ${
                          (h.gain_loss_pct || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {formatPct(h.gain_loss_pct)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6 text-center py-16">
            <p className="text-muted-foreground mb-4">No holdings yet. Import a CSV to get started.</p>
            <Button asChild>
              <Link href="/portfolio/import">
                <Upload className="h-4 w-4 mr-2" />
                Import CSV
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
