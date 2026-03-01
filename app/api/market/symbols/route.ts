import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('tracked_symbols')
    .select('id, symbol, name, yahoo_symbol')
    .eq('user_id', user.id)
    .eq('track_reason', 'holding')
    .eq('is_active', true)
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data ?? [])
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { symbol?: string; yahoo_symbol?: string }
  const { symbol, yahoo_symbol } = body

  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })

  const { error } = await supabase
    .from('tracked_symbols')
    .update({ yahoo_symbol: yahoo_symbol ?? null })
    .eq('user_id', user.id)
    .eq('symbol', symbol)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
