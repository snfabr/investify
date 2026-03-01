import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import yahooFinance from 'yahoo-finance2'

interface PriceRow {
  symbol: string
  price_date: string
  close_gbp: number
}

export async function GET(request: NextRequest) {
  // Validate cron secret
  const authHeader = request.headers.get('authorization')
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString().split('T')[0]

  // 1. Fetch all active tracked symbols that have a yahoo_symbol
  const { data: trackedRows, error: trackedErr } = await supabase
    .from('tracked_symbols')
    .select('symbol, yahoo_symbol')
    .not('yahoo_symbol', 'is', null)
    .eq('is_active', true)

  if (trackedErr || !trackedRows) {
    return NextResponse.json({ error: 'Failed to fetch tracked symbols' }, { status: 500 })
  }

  let totalProcessed = 0
  let totalInserted  = 0
  const errors: string[] = []

  for (const row of trackedRows) {
    const { symbol, yahoo_symbol } = row as { symbol: string; yahoo_symbol: string }

    try {
      // 2. Find the latest date already in price_history for this symbol
      const { data: latestRow } = await supabase
        .from('price_history')
        .select('price_date')
        .eq('symbol', symbol)
        .order('price_date', { ascending: false })
        .limit(1)
        .single()

      // 3. Determine fetch window
      let period1: Date
      if (latestRow?.price_date) {
        // Subsequent run: fetch from day after the latest stored date
        const latestDate = new Date(latestRow.price_date)
        latestDate.setDate(latestDate.getDate() + 1)
        period1 = latestDate
      } else {
        // First run: fetch 5 years of history
        const fiveYearsAgo = new Date(today)
        fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5)
        period1 = fiveYearsAgo
      }

      // Skip if period1 is today or in the future (already up to date)
      if (period1 >= today) {
        totalProcessed++
        continue
      }

      // 4. Fetch from Yahoo Finance
      const historical = await yahooFinance.historical(yahoo_symbol, {
        period1,
        period2: todayStr,
        interval: '1d',
      }) as Array<{ date: Date; close?: number | null }>

      if (!historical || historical.length === 0) {
        totalProcessed++
        continue
      }

      // 5. Build rows — handle GBp (pence) vs GBP
      const priceRows: PriceRow[] = historical
        .filter(h => h.close != null)
        .map(h => {
          // Yahoo Finance returns GBp for UK funds/stocks (pence) — convert to GBP
          // The currency field is on the quote, not historical rows; we detect by size:
          // UK fund NAVs in pence are typically 100–2000, in GBP 1–20
          // But we can't rely on that heuristic. Instead, check the yahoo_symbol:
          // UK symbols ending in .L typically report in GBp
          const isPence = yahoo_symbol.endsWith('.L') || yahoo_symbol.match(/^0P.*\.L$/)
          const closeGbp = isPence ? h.close! / 100 : h.close!

          return {
            symbol,
            price_date: h.date.toISOString().split('T')[0],
            close_gbp:  closeGbp,
          }
        })

      if (priceRows.length === 0) {
        totalProcessed++
        continue
      }

      // 6. Upsert into price_history (on conflict do nothing)
      const { error: upsertErr, count } = await supabase
        .from('price_history')
        .upsert(priceRows, {
          onConflict:        'symbol,price_date',
          ignoreDuplicates:  true,
          count:             'exact',
        })

      if (upsertErr) {
        errors.push(`${symbol}: ${upsertErr.message}`)
      } else {
        totalInserted += count ?? priceRows.length
      }

      totalProcessed++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${symbol} (${yahoo_symbol}): ${msg}`)
      totalProcessed++
    }
  }

  return NextResponse.json({
    date:      todayStr,
    processed: totalProcessed,
    inserted:  totalInserted,
    errors,
  })
}
