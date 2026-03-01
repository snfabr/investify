import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { syncUserHoldings } from '@/lib/market/sync'

const ConfirmSchema = z.object({
  portfolio: z.object({
    broker:        z.string(),
    accountType:   z.string(),
    totalValueGbp: z.number(),
    cashGbp:       z.number(),
    asOfDate:      z.string(),
    importMethod:  z.enum(['csv', 'api']),
    holdings:      z.array(z.object({
      symbol:          z.string(),
      name:            z.string(),
      isin:            z.string().optional(),
      sedol:           z.string().optional(),
      instrumentType:  z.string(),
      quantity:        z.number(),
      currentPriceGbp: z.number(),
      currentValueGbp: z.number(),
      costBasisGbp:    z.number(),
      avgCostGbp:      z.number(),
      gainLossGbp:     z.number(),
      gainLossPct:     z.number(),
      sector:          z.string().optional(),
      currency:        z.string(),
      accountHolder:   z.string().optional(),
    })),
  }),
  filename: z.string(),
  fileSize: z.number().optional(),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const parsed = ConfirmSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { portfolio, filename, fileSize } = parsed.data
  const totalCostGbp = portfolio.holdings.reduce((sum, h) => sum + h.costBasisGbp, 0)
  const totalGainLossGbp = portfolio.totalValueGbp - totalCostGbp
  const totalGainLossPct = totalCostGbp > 0 ? (totalGainLossGbp / totalCostGbp) * 100 : 0

  // 1. Create portfolio snapshot
  const { data: snapshot, error: snapshotError } = await supabase
    .from('portfolio_snapshots')
    .insert({
      user_id:            user.id,
      snapshot_date:      portfolio.asOfDate,
      total_value_gbp:    portfolio.totalValueGbp,
      total_cost_gbp:     totalCostGbp,
      total_gain_loss_gbp: totalGainLossGbp,
      total_gain_loss_pct: totalGainLossPct,
      cash_gbp:           portfolio.cashGbp,
      num_holdings:       portfolio.holdings.length,
      import_method:      portfolio.importMethod,
      broker:             portfolio.broker,
      source_file:        filename,
    })
    .select('id')
    .single()

  if (snapshotError || !snapshot) {
    return NextResponse.json({ error: 'Failed to create snapshot' }, { status: 500 })
  }

  // 2. Insert snapshot holdings
  const snapshotHoldings = portfolio.holdings.map((h) => ({
    snapshot_id:    snapshot.id,
    user_id:        user.id,
    symbol:         h.symbol,
    name:           h.name,
    isin:           h.isin || null,
    sedol:          h.sedol || null,
    instrument_type: h.instrumentType,
    quantity:       h.quantity,
    price_gbp:      h.currentPriceGbp,
    value_gbp:      h.currentValueGbp,
    cost_basis_gbp: h.costBasisGbp,
    gain_loss_gbp:  h.gainLossGbp,
    gain_loss_pct:  h.gainLossPct,
    account_holder: h.accountHolder || '',
    allocation_pct: portfolio.totalValueGbp > 0
      ? (h.currentValueGbp / portfolio.totalValueGbp) * 100
      : 0,
  }))

  const { error: shError } = await supabase
    .from('snapshot_holdings')
    .insert(snapshotHoldings)

  if (shError) {
    return NextResponse.json({ error: 'Failed to create snapshot holdings' }, { status: 500 })
  }

  // 3. Upsert current holdings
  const now = new Date().toISOString()
  for (const h of portfolio.holdings) {
    await supabase
      .from('holdings')
      .upsert(
        {
          user_id:          user.id,
          symbol:           h.symbol,
          name:             h.name,
          isin:             h.isin || null,
          sedol:            h.sedol || null,
          instrument_type:  h.instrumentType,
          quantity:         h.quantity,
          avg_cost_gbp:     h.avgCostGbp,
          cost_basis_gbp:   h.costBasisGbp,
          current_price_gbp: h.currentPriceGbp,
          current_value_gbp: h.currentValueGbp,
          gain_loss_gbp:    h.gainLossGbp,
          gain_loss_pct:    h.gainLossPct,
          currency:         h.currency,
          account_holder:   h.accountHolder || '',
          is_active:        true,
          last_import_at:   now,
        },
        { onConflict: 'user_id,symbol,account_holder' }
      )
  }

  // 4. Mark holdings not in this import as inactive
  const importedSymbols = portfolio.holdings.map((h) => h.symbol)
  await supabase
    .from('holdings')
    .update({ is_active: false })
    .eq('user_id', user.id)
    .not('symbol', 'in', `(${importedSymbols.map((s) => `"${s}"`).join(',')})`)

  // 5. Log the CSV import
  await supabase.from('csv_imports').insert({
    user_id:       user.id,
    snapshot_id:   snapshot.id,
    filename,
    file_size:     fileSize || null,
    broker:        portfolio.broker,
    rows_parsed:   portfolio.holdings.length,
    rows_imported: portfolio.holdings.length,
    status:        'success',
  })

  // 6. Auto-link any unlinked symbols to Yahoo Finance (fast — no price fetch yet)
  const { linked } = await syncUserHoldings(user.id, supabase, { onlyAutoLink: true })

  return NextResponse.json({ snapshotId: snapshot.id, holdingsCount: portfolio.holdings.length, linked })
}
