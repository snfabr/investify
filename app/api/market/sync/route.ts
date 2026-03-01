import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncUserHoldings } from '@/lib/market/sync'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await syncUserHoldings(user.id, supabase)
  return NextResponse.json(result)
}
