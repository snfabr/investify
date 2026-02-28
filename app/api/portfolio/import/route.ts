import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdapter } from '@/lib/broker'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const broker = (formData.get('broker') as string) || 'fidelity_uk'

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  if (!file.name.endsWith('.csv')) {
    return NextResponse.json({ error: 'File must be a CSV' }, { status: 400 })
  }

  const csvContent = await file.text()

  try {
    const adapter = getAdapter(broker)
    const portfolio = await adapter.parseImport(csvContent, 'csv')

    return NextResponse.json({
      portfolio,
      filename: file.name,
      fileSize: file.size,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse CSV'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}
