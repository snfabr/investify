import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import yahooFinance from 'yahoo-finance2'

const ALLOWED_TYPES = new Set(['MUTUALFUND', 'ETF', 'EQUITY'])

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = request.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 2) {
    return NextResponse.json({ error: 'Query too short' }, { status: 400 })
  }

  try {
    const result = await yahooFinance.search(q, {
      quotesCount: 8,
      newsCount: 0,
    }) as { quotes?: Array<{
      symbol?: string
      shortname?: string
      longname?: string
      quoteType?: string
      typeDisp?: string
      exchange?: string
    }> }

    const quotes = (result.quotes ?? [])
      .filter(r => r.quoteType && ALLOWED_TYPES.has(r.quoteType))
      .map(r => ({
        symbol:   r.symbol ?? '',
        name:     r.longname ?? r.shortname ?? r.symbol ?? '',
        typeDisp: r.typeDisp ?? r.quoteType ?? '',
        exchange: r.exchange ?? '',
      }))
      .filter(r => r.symbol)

    return NextResponse.json(quotes)
  } catch (err) {
    console.error('[market/search]', err)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
