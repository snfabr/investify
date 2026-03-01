import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Upload, BarChart2 } from 'lucide-react'
import { PortfolioHoldings } from '@/components/portfolio-holdings'

export default async function PortfolioPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: holdings } = await supabase
    .from('holdings')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('current_value_gbp', { ascending: false })

  const { data: lastImport } = await supabase
    .from('csv_imports')
    .select('created_at, filename')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Portfolio</h1>
          {lastImport && (
            <p className="text-sm text-muted-foreground">
              Last import: {new Date(lastImport.created_at).toLocaleDateString('en-GB')} ({lastImport.filename})
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/portfolio/data">
              <BarChart2 className="h-4 w-4 mr-2" />
              Market data
            </Link>
          </Button>
          <Button asChild>
            <Link href="/portfolio/import">
              <Upload className="h-4 w-4 mr-2" />
              Import CSV
            </Link>
          </Button>
        </div>
      </div>

      {holdings && holdings.length > 0 ? (
        <PortfolioHoldings holdings={holdings} />
      ) : (
        <Card>
          <CardContent className="pt-6 text-center py-16">
            <p className="text-muted-foreground mb-4">No holdings yet. Import a CSV to get started.</p>
            <Button asChild>
              <Link href="/portfolio/import">
                <Upload className="h-4 w-4 mr-2" />
                Import CSV
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
