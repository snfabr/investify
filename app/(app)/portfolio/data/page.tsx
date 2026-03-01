'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckCircle2, AlertCircle, Search, X, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TrackedSymbol {
  id: string
  symbol: string
  name: string
  yahoo_symbol: string | null
}

interface SearchResult {
  symbol: string
  name: string
  typeDisp: string
  exchange: string
}

// ── Symbol row component ──────────────────────────────────────────────────────

function SymbolRow({
  row,
  onLinked,
}: {
  row: TrackedSymbol
  onLinked: (symbol: string, yahooSymbol: string | null) => void
}) {
  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [open, setOpen]           = useState(false)

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/market/search?q=${encodeURIComponent(q)}`)
      const data = await res.json() as SearchResult[]
      setResults(Array.isArray(data) ? data : [])
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => { if (open) search(query) }, 400)
    return () => clearTimeout(t)
  }, [query, open, search])

  async function save(yahooSymbol: string | null) {
    setSaving(true)
    try {
      const res = await fetch('/api/market/symbols', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ symbol: row.symbol, yahoo_symbol: yahooSymbol }),
      })
      if (!res.ok) throw new Error('Save failed')
      onLinked(row.symbol, yahooSymbol)
      toast.success(yahooSymbol ? `Linked to ${yahooSymbol}` : 'Link removed')
      setOpen(false)
      setQuery('')
      setResults([])
    } catch {
      toast.error('Failed to save — please try again')
    } finally {
      setSaving(false)
    }
  }

  const isLinked = Boolean(row.yahoo_symbol)

  return (
    <div className="space-y-2 py-3 border-b last:border-0">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate">{row.name || row.symbol}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge variant="outline" className="font-mono text-xs">{row.symbol}</Badge>
            {isLinked && (
              <span className="text-xs text-muted-foreground font-mono">{row.yahoo_symbol}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isLinked ? (
            <>
              <Badge className="bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800 gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Linked
              </Badge>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(o => !o)}>
                Change
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-destructive hover:text-destructive"
                disabled={saving}
                onClick={() => save(null)}
              >
                <X className="h-3 w-3" />
              </Button>
            </>
          ) : (
            <>
              <Badge variant="outline" className="text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700 gap-1">
                <AlertCircle className="h-3 w-3" />
                Not linked
              </Badge>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOpen(o => !o)}>
                Link
              </Button>
            </>
          )}
        </div>
      </div>

      {open && (
        <div className="space-y-2 pl-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-8 h-8 text-sm"
              placeholder={`Search Yahoo Finance for "${row.name || row.symbol}"…`}
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus
            />
          </div>

          {searching && (
            <div className="space-y-1">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          )}

          {!searching && results.length > 0 && (
            <div className="border rounded-md divide-y">
              {results.map(r => (
                <button
                  key={r.symbol}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted text-left"
                  disabled={saving}
                  onClick={() => save(r.symbol)}
                >
                  <span className="flex flex-col min-w-0">
                    <span className="font-mono font-medium text-xs">{r.symbol}</span>
                    <span className="text-muted-foreground truncate text-xs">{r.name}</span>
                  </span>
                  <span className="flex-shrink-0 ml-3">
                    <Badge variant="secondary" className="text-xs">{r.typeDisp || r.exchange}</Badge>
                  </span>
                </button>
              ))}
            </div>
          )}

          {!searching && query.length >= 2 && results.length === 0 && (
            <p className="text-xs text-muted-foreground px-1">No results — try a different search term</p>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => { setOpen(false); setQuery(''); setResults([]) }}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PortfolioDataPage() {
  const [symbols, setSymbols] = useState<TrackedSymbol[]>([])
  const [loading, setSyncing] = useState(true)
  const [syncing, setSyncingPrices] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  const loadSymbols = useCallback(async () => {
    const res  = await fetch('/api/market/symbols')
    const data = await res.json() as TrackedSymbol[]
    setSymbols(Array.isArray(data) ? data : [])
    setSyncing(false)
  }, [])

  useEffect(() => { loadSymbols() }, [loadSymbols])

  function handleLinked(symbol: string, yahooSymbol: string | null) {
    setSymbols(prev =>
      prev.map(s => s.symbol === symbol ? { ...s, yahoo_symbol: yahooSymbol } : s)
    )
  }

  async function handleSync() {
    setSyncingPrices(true)
    setSyncMsg(null)
    try {
      const res = await fetch('/api/market/sync', { method: 'POST' })
      const data = await res.json() as { linked: number; fetched: number; errors: string[] }
      const parts: string[] = []
      if (data.linked > 0) parts.push(`${data.linked} newly linked`)
      if (data.fetched > 0) parts.push(`${data.fetched.toLocaleString()} price points fetched`)
      setSyncMsg(parts.length > 0 ? parts.join(' · ') : 'All prices already up to date')
      // Reload to reflect any newly auto-linked symbols
      await loadSymbols()
    } catch {
      setSyncMsg('Sync failed — please try again')
    } finally {
      setSyncingPrices(false)
    }
  }

  const linked   = symbols.filter(s => s.yahoo_symbol)
  const unlinked = symbols.filter(s => !s.yahoo_symbol)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Market data</h1>
          <p className="text-sm text-muted-foreground">
            Link each holding to its Yahoo Finance symbol to enable daily price history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleSync}
            disabled={syncing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync prices'}
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/portfolio">Back</Link>
          </Button>
        </div>
      </div>

      {syncMsg && (
        <p className="text-sm text-muted-foreground">{syncMsg}</p>
      )}

      {!loading && symbols.length > 0 && (
        <div className="flex gap-4 text-sm">
          <span className="text-green-600 font-medium">{linked.length} linked</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-amber-600 font-medium">{unlinked.length} not linked</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{symbols.length} total holdings</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Holdings</CardTitle>
        </CardHeader>
        <CardContent className="p-0 px-6">
          {loading ? (
            <div className="space-y-3 py-3">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : symbols.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-muted-foreground text-sm">No holdings found.</p>
              <p className="text-muted-foreground text-sm">Import a CSV first to populate your holdings.</p>
            </div>
          ) : (
            <div>
              {symbols.map(s => (
                <SymbolRow key={s.symbol} row={s} onLinked={handleLinked} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
