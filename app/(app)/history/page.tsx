import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { HistoryView } from '@/components/history-view'

export interface PortfolioImport {
  id: string
  created_at: string
  filename: string
  rows_imported: number | null
  status: string
  snapshot_id: string | null
}

export interface ActionSession {
  id: string
  created_at: string
  completed_at: string | null
  title: string
  summary: string | null
  recommendation: Record<string, unknown> | null
  status: string
}

export type HistoryEntry =
  | { type: 'import'; date: string; data: PortfolioImport }
  | { type: 'action'; date: string; data: ActionSession }

export default async function HistoryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const [importsResult, sessionsResult] = await Promise.all([
    supabase
      .from('csv_imports')
      .select('id, created_at, filename, rows_imported, status, snapshot_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('action_sessions')
      .select('id, created_at, completed_at, title, summary, recommendation, status')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
  ])

  const imports = (importsResult.data || []) as PortfolioImport[]
  const sessions = (sessionsResult.data || []) as ActionSession[]

  // Merge and sort chronologically (newest first)
  const entries: HistoryEntry[] = [
    ...imports.map(i => ({ type: 'import' as const, date: i.created_at, data: i })),
    ...sessions.map(s => ({ type: 'action' as const, date: s.created_at, data: s })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return <HistoryView entries={entries} />
}
