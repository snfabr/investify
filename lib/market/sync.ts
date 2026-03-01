import yahooFinance from 'yahoo-finance2'
import { createServiceClient } from '@/lib/supabase/server'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PriceRow {
  symbol:     string
  price_date: string
  close_gbp:  number
}

// Duck-typed Supabase client — accepts both user and service clients
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any

// ── Auto-link: find the best Yahoo Finance symbol for a fund name ─────────────

const PREFERRED_TYPES = ['MUTUALFUND', 'ETF', 'EQUITY']

/**
 * Shorten a full fund name to its core brand words so Yahoo's search works better.
 * e.g. "Fundsmith Equity Fund I Class Accumulation" → "Fundsmith Equity"
 *      "JPM Emerging Markets Fund B - Net Accumulation" → "JPM Emerging Markets"
 */
function simplifyFundName(name: string): string {
  const s = name
    // Strip trailing share-class / accumulation junk
    .replace(/\s*\([^)]*\)\s*$/g, '')                           // remove trailing (...)
    .replace(/\s+-\s+(Net\s+)?Accumulation\s*$/gi, '')          // "- Net Accumulation"
    .replace(/\s+(W|I|Z|B|C|D|Inst|GBP)\s*-?\s*Acc(umulation)?\s*$/gi, '') // "I Acc"
    .replace(/\s+Class\s+[A-Z]\s+Acc(umulation)?\s*$/gi, '')   // "Class I Acc"
    .replace(/\s+Fund\b.*/i, '')                                // "Fund" and everything after
    .trim()

  // Cap at 4 words — Yahoo's search handles short queries better
  const words = s.split(/\s+/)
  return words.length > 4 ? words.slice(0, 4).join(' ') : s
}

export async function autoLinkSymbol(name: string): Promise<{ symbol: string | null; error?: string }> {
  if (!name) return { symbol: null }
  const query = simplifyFundName(name) || name
  try {
    const result = await yahooFinance.search(
      query,
      { quotesCount: 8, newsCount: 0 },
      { validateResult: false },
    ) as {
      quotes?: Array<{
        symbol?:    string
        quoteType?: string
      }>
    }

    const quotes = result.quotes ?? []
    for (const type of PREFERRED_TYPES) {
      const match = quotes.find(q => q.quoteType === type && q.symbol)
      if (match?.symbol) return { symbol: match.symbol }
    }
    return { symbol: null }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { symbol: null, error: `search("${query}"): ${msg}` }
  }
}

// ── Price fetch: download history from Yahoo and upsert into price_history ────

export async function fetchPriceHistoryForSymbol(
  internalSymbol: string,
  yahooSymbol:    string,
): Promise<{ inserted: number; error?: string }> {
  const supabase = await createServiceClient()

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString().split('T')[0]

  try {
    // Find the latest date already stored for this symbol
    const { data: latestRow } = await supabase
      .from('price_history')
      .select('price_date')
      .eq('symbol', internalSymbol)
      .order('price_date', { ascending: false })
      .limit(1)
      .single()

    let period1: Date
    if (latestRow?.price_date) {
      // Subsequent run: start from day after last stored date
      const latestDate = new Date(latestRow.price_date)
      latestDate.setDate(latestDate.getDate() + 1)
      period1 = latestDate
    } else {
      // First run: fetch 5 years of history
      const fiveYearsAgo = new Date(today)
      fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5)
      period1 = fiveYearsAgo
    }

    // Already up to date — nothing to fetch
    if (period1 >= today) return { inserted: 0 }

    const historical = await yahooFinance.historical(yahooSymbol, {
      period1,
      period2:  todayStr,
      interval: '1d',
    }) as Array<{ date: Date; close?: number | null }>

    if (!historical?.length) return { inserted: 0 }

    // UK symbols (ending .L, or 0P*.L mutual funds) quote in GBp (pence) → divide by 100
    const isPence = yahooSymbol.endsWith('.L') || Boolean(yahooSymbol.match(/^0P.*\.L$/))

    const priceRows: PriceRow[] = historical
      .filter(h => h.close != null)
      .map(h => ({
        symbol:     internalSymbol,
        price_date: h.date.toISOString().split('T')[0],
        close_gbp:  isPence ? h.close! / 100 : h.close!,
      }))

    if (!priceRows.length) return { inserted: 0 }

    const { count, error: upsertErr } = await supabase
      .from('price_history')
      .upsert(priceRows, {
        onConflict:       'symbol,price_date',
        ignoreDuplicates: true,
        count:            'exact',
      })

    if (upsertErr) return { inserted: 0, error: upsertErr.message }
    return { inserted: count ?? priceRows.length }
  } catch (err) {
    return { inserted: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Full sync: auto-link unlinked symbols then fetch price history ─────────────

export interface SyncResult {
  linked:  number
  fetched: number
  errors:  string[]
}

export async function syncUserHoldings(
  userId:       string,
  userSupabase: AnySupabase,
  opts: { onlyAutoLink?: boolean } = {},
): Promise<SyncResult> {
  let linked  = 0
  let fetched = 0
  const errors: string[] = []

  // Get all active holding-tracked symbols for this user
  const { data: rows } = await userSupabase
    .from('tracked_symbols')
    .select('symbol, name, yahoo_symbol')
    .eq('user_id', userId)
    .eq('track_reason', 'holding')
    .eq('is_active', true)

  if (!rows?.length) return { linked: 0, fetched: 0, errors: [] }

  for (const row of rows as { symbol: string; name: string; yahoo_symbol: string | null }[]) {
    // Cash holdings have no market price
    if (row.symbol === 'CASH') continue

    let yahooSymbol = row.yahoo_symbol

    // Auto-link if not already linked
    if (!yahooSymbol) {
      const { symbol: found, error: linkErr } = await autoLinkSymbol(row.name || row.symbol)
      if (linkErr) errors.push(`auto-link ${row.symbol}: ${linkErr}`)
      if (found) {
        await userSupabase
          .from('tracked_symbols')
          .update({ yahoo_symbol: found })
          .eq('user_id', userId)
          .eq('symbol', row.symbol)
        yahooSymbol = found
        linked++
      }
    }

    // Optionally skip history fetch (for fast auto-link-only mode)
    if (opts.onlyAutoLink) continue

    // Fetch price history if we have a Yahoo symbol
    if (yahooSymbol) {
      const result = await fetchPriceHistoryForSymbol(row.symbol, yahooSymbol)
      fetched += result.inserted
      if (result.error) errors.push(`${row.symbol}: ${result.error}`)
    }
  }

  return { linked, fetched, errors }
}
