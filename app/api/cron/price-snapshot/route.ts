import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchPriceHistoryForSymbol } from '@/lib/market/sync'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()
  const todayStr = new Date().toISOString().split('T')[0]

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

  for (const row of trackedRows as { symbol: string; yahoo_symbol: string }[]) {
    const result = await fetchPriceHistoryForSymbol(row.symbol, row.yahoo_symbol)
    totalInserted += result.inserted
    if (result.error) errors.push(`${row.symbol}: ${result.error}`)
    totalProcessed++
  }

  return NextResponse.json({
    date:      todayStr,
    processed: totalProcessed,
    inserted:  totalInserted,
    errors,
  })
}
