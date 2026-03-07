import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const RestoreSchema = z.object({
  profileId: z.string().uuid(),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const parsed = RestoreSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { profileId } = parsed.data

  // Verify the profile belongs to the user
  const { data: targetProfile, error: fetchError } = await supabase
    .from('strategy_profiles')
    .select('id')
    .eq('id', profileId)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !targetProfile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  // Set all user profiles to is_current=false, then set target to true
  // (The deactivate_old_profiles trigger only fires on INSERT, not UPDATE,
  //  so we must do this manually)
  const { error: deactivateError } = await supabase
    .from('strategy_profiles')
    .update({ is_current: false })
    .eq('user_id', user.id)

  if (deactivateError) {
    return NextResponse.json({ error: deactivateError.message }, { status: 500 })
  }

  const { error: activateError } = await supabase
    .from('strategy_profiles')
    .update({ is_current: true })
    .eq('id', profileId)
    .eq('user_id', user.id)

  if (activateError) {
    return NextResponse.json({ error: activateError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
