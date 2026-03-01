'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Upload, CheckCircle, AlertCircle, ArrowLeft } from 'lucide-react'
import type { BrokerPortfolio, BrokerHolding } from '@/lib/broker/types'

type ImportState = 'idle' | 'parsing' | 'review' | 'confirming' | 'done' | 'error'

function formatGbp(value: number) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
}

function formatPct(value: number) {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

export default function PortfolioImportPage() {
  const [state, setState] = useState<ImportState>('idle')
  const [portfolio, setPortfolio] = useState<BrokerPortfolio | null>(null)
  const [filename, setFilename] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [selectedHolders, setSelectedHolders] = useState<string[]>([])
  const router = useRouter()

  async function handleFile(file: File) {
    if (!file.name.endsWith('.csv')) {
      setError('Please upload a CSV file')
      return
    }

    setFilename(file.name)
    setFileSize(file.size)
    setState('parsing')
    setError(null)

    const form = new FormData()
    form.append('file', file)
    form.append('broker', 'fidelity_uk')

    try {
      const res = await fetch('/api/portfolio/import', { method: 'POST', body: form })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to parse CSV')
      }

      setPortfolio(data.portfolio)
      setSelectedHolders([])
      setState('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setState('error')
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  async function handleConfirm() {
    if (!portfolio) return
    setState('confirming')

    try {
      const res = await fetch('/api/portfolio/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolio, filename, fileSize }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to confirm import')
      }

      setState('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setState('error')
    }
  }

  function toggleHolder(name: string) {
    setSelectedHolders(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    )
  }

  // Derive account holders and filtered holdings
  const accountHolders = portfolio
    ? [...new Set(portfolio.holdings.map(h => h.accountHolder).filter(Boolean))].sort() as string[]
    : []

  const visibleHoldings: BrokerHolding[] = portfolio
    ? (selectedHolders.length === 0
        ? portfolio.holdings
        : portfolio.holdings.filter(h => selectedHolders.includes(h.accountHolder ?? '')))
    : []

  if (state === 'done') {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Card>
          <CardContent className="pt-6 text-center space-y-4">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
            <h2 className="text-xl font-semibold">Import successful</h2>
            <p className="text-muted-foreground">
              {portfolio?.holdings.length} holdings imported from {filename}
            </p>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => router.push('/portfolio')}>View portfolio</Button>
              <Button variant="outline" onClick={() => setState('idle')}>Import another</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/portfolio')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Import Portfolio CSV</h1>
          <p className="text-muted-foreground">Upload your Fidelity UK portfolio export</p>
        </div>
      </div>

      {(state === 'idle' || state === 'error') && (
        <Card>
          <CardHeader>
            <CardTitle>Upload CSV</CardTitle>
            <CardDescription>
              Download your portfolio from Fidelity UK (Portfolio → Download CSV), then upload it here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer ${
                isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => document.getElementById('csv-input')?.click()}
            >
              <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-medium">Drop your CSV here, or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">Supports Fidelity UK portfolio exports</p>
              <input
                id="csv-input"
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileInput}
              />
            </div>

            {error && (
              <div className="mt-4 flex items-start gap-2 text-sm text-red-600 bg-red-50 px-4 py-3 rounded">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <p>{error}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {state === 'parsing' && (
        <Card>
          <CardContent className="pt-6 text-center py-12">
            <div className="animate-pulse text-muted-foreground">Parsing CSV…</div>
          </CardContent>
        </Card>
      )}

      {(state === 'review' || state === 'confirming') && portfolio && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Review import</CardTitle>
              <CardDescription>
                Confirm the holdings below match your portfolio, then click Import to save.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Summary stats for the full import (always shows totals) */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-muted rounded-lg p-4">
                  <p className="text-xs text-muted-foreground">Total value</p>
                  <p className="text-lg font-bold">{formatGbp(portfolio.totalValueGbp)}</p>
                </div>
                <div className="bg-muted rounded-lg p-4">
                  <p className="text-xs text-muted-foreground">Holdings (incl. cash)</p>
                  <p className="text-lg font-bold">{portfolio.holdings.length}</p>
                </div>
                <div className="bg-muted rounded-lg p-4">
                  <p className="text-xs text-muted-foreground">Cash available</p>
                  <p className="text-lg font-bold">{formatGbp(portfolio.cashGbp)}</p>
                </div>
              </div>

              {/* Account holder filter */}
              {accountHolders.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-muted-foreground">Show:</span>
                  <Button
                    size="sm"
                    variant={selectedHolders.length === 0 ? 'default' : 'outline'}
                    onClick={() => setSelectedHolders([])}
                  >
                    All accounts
                  </Button>
                  {accountHolders.map(name => (
                    <Button
                      key={name}
                      size="sm"
                      variant={selectedHolders.includes(name) ? 'default' : 'outline'}
                      onClick={() => toggleHolder(name)}
                    >
                      {name}
                    </Button>
                  ))}
                </div>
              )}

              {/* Holdings table */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Type</TableHead>
                    {accountHolders.length > 1 && <TableHead>Holder</TableHead>}
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Gain/Loss</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleHoldings.map((h: BrokerHolding) => {
                    const isCash = h.instrumentType === 'cash'
                    return (
                      <TableRow key={`${h.symbol}-${h.accountHolder}`}>
                        <TableCell className="font-medium max-w-48 truncate">{h.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">{h.symbol}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{h.instrumentType}</Badge>
                        </TableCell>
                        {accountHolders.length > 1 && (
                          <TableCell className="text-sm text-muted-foreground">
                            {h.accountHolder?.split(' ')[0] ?? '—'}
                          </TableCell>
                        )}
                        <TableCell className="text-right tabular-nums">
                          {isCash ? '—' : h.quantity.toFixed(4)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatGbp(h.currentValueGbp)}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${
                          isCash
                            ? 'text-muted-foreground'
                            : h.gainLossPct >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {isCash ? '—' : formatPct(h.gainLossPct)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => setState('idle')} disabled={state === 'confirming'}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={state === 'confirming'}>
              {state === 'confirming' ? 'Saving…' : 'Confirm import'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
