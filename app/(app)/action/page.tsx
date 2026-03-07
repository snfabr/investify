import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ActionView } from '@/components/action-view'

export default async function ActionPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('strategy_profiles')
    .select('id')
    .eq('user_id', user.id)
    .eq('is_current', true)
    .single()

  if (!profile) {
    redirect('/onboarding')
  }

  // Fetch previous completed sessions (most recent first, no messages column to keep payload small)
  const { data: previousSessions } = await supabase
    .from('action_sessions')
    .select('id, created_at, completed_at, title, summary, recommendation')
    .eq('user_id', user.id)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(10)

  return <ActionView previousSessions={previousSessions ?? []} />
}
