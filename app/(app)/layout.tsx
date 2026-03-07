import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard,
  Bell,
  TrendingUp,
  Target,
  History,
  Settings,
  Briefcase,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { SignOutButton } from '@/components/sign-out-button'

const NAV_ITEMS = [
  { href: '/dashboard',   label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/portfolio',   label: 'Portfolio',    icon: Briefcase },
  { href: '/alerts',      label: 'Alerts',       icon: Bell, badge: true },
  { href: '/performance', label: 'Performance',  icon: TrendingUp },
  { href: '/strategy',    label: 'Strategy',     icon: Target },
  { href: '/action',      label: 'Action',       icon: Zap },
  { href: '/history',     label: 'History',      icon: History },
  { href: '/settings',    label: 'Settings',     icon: Settings },
]

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch unread alert count
  const { count: unreadAlerts } = await supabase
    .from('alerts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('is_read', false)
    .eq('is_dismissed', false)

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 border-r bg-card flex flex-col">
        <div className="p-4 border-b">
          <h1 className="font-bold text-lg tracking-tight">Investify</h1>
          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon, badge }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2 rounded-md text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1">{label}</span>
              {badge && unreadAlerts && unreadAlerts > 0 && (
                <Badge variant="destructive" className="h-5 min-w-5 text-xs px-1">
                  {unreadAlerts > 99 ? '99+' : unreadAlerts}
                </Badge>
              )}
            </Link>
          ))}
        </nav>

        <div className="p-2 border-t">
          <SignOutButton />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  )
}
