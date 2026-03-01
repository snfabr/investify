'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AllocationChart } from '@/components/allocation-chart'

interface Holding {
  id: string
  symbol: string
  name: string
  instrument_type: string
  current_value_gbp: number | null
  cost_basis_gbp: number | null
  gain_loss_pct: number | null
  account_holder: string
}

interface Props {
  holdings: Holding[]
}

function formatGbp(value: number | null) {
  if (value === null) return '—'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
}

function formatPct(value: number | null) {
  if (value === null) return '—'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

export function PortfolioHoldings({ holdings }: Props) {
  const accountHolders = [...new Set(
    holdings.map(h => h.account_holder).filter(Boolean)
  )].sort()

  const [selected, setSelected] = useState<string[]>([]) // empty = show all

  function toggle(name: string) {
    setSelected(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    )
  }

  const visible = selected.length === 0
    ? holdings
    : holdings.filter(h => selected.includes(h.account_holder))

  const totalValue = visible.reduce((s, h) => s + (h.current_value_gbp ?? 0), 0)
  const totalCost  = visible.reduce((s, h) => s + (h.cost_basis_gbp ?? 0), 0)
  const totalGain  = totalValue - totalCost
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0

  const chartData = visible
    .filter(h => (h.current_value_gbp ?? 0) > 0)
    .map(h => ({
      name: h.symbol,
      value: h.current_value_gbp ?? 0,
      pct: totalValue > 0 ? ((h.current_value_gbp ?? 0) / totalValue) * 100 : 0,
    }))

  return (
    <div className="space-y-6">
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

      {/* Account holder filter */}
      {accountHolders.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground">Show:</span>
          <Button
            size="sm"
            variant={selected.length === 0 ? 'default' : 'outline'}
            onClick={() => setSelected([])}
          >
            All accounts
          </Button>
          {accountHolders.map(name => (
            <Button
              key={name}
              size="sm"
              variant={selected.includes(name) ? 'default' : 'outline'}
              onClick={() => toggle(name)}
            >
              {name}
            </Button>
          ))}
        </div>
      )}

      {/* Chart + table */}
      <div className="grid grid-cols-3 gap-6">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Allocation</CardTitle>
          </CardHeader>
          <CardContent>
            <AllocationChart data={chartData} />
          </CardContent>
        </Card>

        <Card className="col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Holdings ({visible.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  {accountHolders.length > 1 && <TableHead>Holder</TableHead>}
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Alloc %</TableHead>
                  <TableHead className="text-right">Gain/Loss</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((h) => {
                  const allocPct = totalValue > 0
                    ? ((h.current_value_gbp ?? 0) / totalValue) * 100 : 0
                  const isCash = h.instrument_type === 'cash'
                  return (
                    <TableRow key={h.id}>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">{h.symbol}</Badge>
                      </TableCell>
                      <TableCell className="max-w-40 truncate text-sm">{h.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">{h.instrument_type}</Badge>
                      </TableCell>
                      {accountHolders.length > 1 && (
                        <TableCell className="text-sm text-muted-foreground">
                          {h.account_holder
                            ? h.account_holder.split(' ')[0]  // first name only
                            : '—'}
                        </TableCell>
                      )}
                      <TableCell className="text-right tabular-nums text-sm">
                        {formatGbp(h.current_value_gbp)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {allocPct.toFixed(1)}%
                      </TableCell>
                      <TableCell className={`text-right tabular-nums text-sm ${
                        isCash
                          ? 'text-muted-foreground'
                          : (h.gain_loss_pct ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {isCash ? '—' : formatPct(h.gain_loss_pct)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
