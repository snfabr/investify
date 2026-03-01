import Papa from 'papaparse'
import type { BrokerAdapter, BrokerHolding, BrokerPortfolio } from './types'

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseNum(value: string | undefined | null): number {
  if (!value) return 0
  const cleaned = String(value).replace(/[£,+\s]/g, '').trim()
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

function inferInstrumentType(name: string): BrokerHolding['instrumentType'] {
  const l = name.toLowerCase()
  if (l.includes('etf') || l.includes('exchange traded')) return 'etf'
  if (l.includes('investment trust') || l.includes('inv trust')) return 'investment_trust'
  if (l.includes('gilt') || l.includes('treasury')) return 'bond'
  if (l.includes('fund') || l.includes('feeder') || l.includes('accumulation') || l.includes(' acc')) return 'fund'
  if (l.includes('cash') || l.includes('money market')) return 'cash'
  return 'stock'
}

/**
 * Turn a fund name into a stable short symbol — used as the internal
 * identifier since Fidelity's export contains no ticker/SEDOL/ISIN.
 *
 * "Fidelity Global Dividend Fund W-Accumulation (UK)" →
 *   "FIDELITY_GLOBAL_DIVIDEND_W"
 */
function nameToSymbol(name: string): string {
  const STOP = ['fund', 'accumulation', 'feeder', 'class', 'limited',
                'management', 'asset', 'managers', 'securities', 'the',
                'and', 'for', 'of', 'uk']
  const words = name
    .replace(/[()&]/g, ' ')
    .split(/[\s\-]+/)
    .map(w => w.replace(/[^A-Za-z0-9]/g, ''))
    .filter(w => w.length > 1 && !STOP.includes(w.toLowerCase()))
  return words.join('_').toUpperCase().slice(0, 40)
}

/** Extract the export date from the preamble lines, e.g. "Export date,28/02/2026" */
function extractExportDate(lines: string[]): string {
  for (const line of lines.slice(0, 10)) {
    const m = line.match(/export date[,\s]+(\d{2}\/\d{2}\/\d{4})/i)
    if (m) {
      const [day, month, year] = m[1].split('/')
      return `${year}-${month}-${day}`
    }
  }
  return new Date().toISOString().split('T')[0]
}

// ── Parser ───────────────────────────────────────────────────────────────────

/**
 * Fidelity UK "AccountSummary.csv" parser.
 *
 * The file has a complex structure:
 *
 *   Lines 1–N  — metadata (client name, export date, overview totals)
 *   Header row — "Type,Holdings,Account number,Product,..."
 *   Data rows  — Type = "Account" (summary) or "Asset" (holding)
 *   ... repeated for each section
 *
 * We find every section by locating rows where column 0 === "Type",
 * then keep only "Asset" rows where Product === "Investment ISA".
 * Cash comes from matching "Account" rows (Cash available column),
 * stored as individual Cash holdings tagged to each account holder.
 */
export const fidelityCsvAdapter: BrokerAdapter = {
  name: 'fidelity_uk',

  async parseImport(data: string): Promise<BrokerPortfolio> {
    const rawLines = data.split(/\r?\n/)
    const asOfDate = extractExportDate(rawLines)

    // Parse the whole file as a flat array of string arrays
    const parsed = Papa.parse<string[]>(data, {
      header: false,
      skipEmptyLines: true,
    })

    if (parsed.errors.some(e => e.type === 'Delimiter')) {
      throw new Error('Could not parse CSV — unexpected format')
    }

    const rows: string[][] = parsed.data as string[][]

    // ── Find section header rows ─────────────────────────────────────────────
    // A header row has "Type" as the first cell.
    const headerIndices: number[] = []
    rows.forEach((row, i) => {
      if (row[0]?.trim() === 'Type') headerIndices.push(i)
    })

    if (headerIndices.length === 0) {
      throw new Error(
        'Could not find data table in CSV. Expected Fidelity "AccountSummary.csv" format.'
      )
    }

    // ── Process each section ─────────────────────────────────────────────────
    const holdings: BrokerHolding[] = []
    // Cash per account holder: Map<accountHolder, cashGbp>
    const cashByHolder = new Map<string, number>()

    for (let s = 0; s < headerIndices.length; s++) {
      const headerRow = rows[headerIndices[s]]
      const sectionEnd = s + 1 < headerIndices.length
        ? headerIndices[s + 1]
        : rows.length

      // Map column name → index for this section
      const col: Record<string, number> = {}
      headerRow.forEach((h, i) => { col[h.trim()] = i })

      const required = ['Type', 'Holdings', 'Value (£)', 'Latest price (pence/cents/yen)', 'Quantity']
      if (!required.every(k => k in col)) continue  // Skip malformed/overview sections

      const sectionRows = rows.slice(headerIndices[s] + 1, sectionEnd)

      for (const row of sectionRows) {
        const type          = row[col['Type']]?.trim()
        const product       = row[col['Product']]?.trim() ?? ''
        const accountHolder = row[col['Account holder']]?.trim() ?? ''

        // Only process Investment ISA rows
        if (product !== 'Investment ISA') continue

        if (type === 'Account') {
          // Accumulate ISA cash per account holder
          const cash = parseNum(row[col['Cash available']])
          if (cash > 0) {
            cashByHolder.set(
              accountHolder,
              (cashByHolder.get(accountHolder) ?? 0) + cash
            )
          }
          continue
        }

        if (type !== 'Asset') continue

        const name = row[col['Holdings']]?.trim() ?? ''
        if (!name || name.toLowerCase() === 'cash') continue

        // Price is in pence — divide by 100 for GBP
        const pricePence = parseNum(row[col['Latest price (pence/cents/yen)']])
        const priceGbp   = pricePence / 100

        const quantity    = parseNum(row[col['Quantity']])
        const valueGbp    = parseNum(row[col['Value (£)']])
        const costBasis   = parseNum(row[col['Book cost (£)']])
        const gainLossGbp = parseNum(row[col['Gain/loss (£)']])
        const gainLossPct = parseNum(row[col['Gain/loss (%)']])

        const effectivePrice = priceGbp > 0 ? priceGbp
          : (quantity > 0 ? valueGbp / quantity : 0)
        const avgCostGbp = quantity > 0 && costBasis > 0 ? costBasis / quantity : effectivePrice

        holdings.push({
          symbol:          nameToSymbol(name),
          name,
          instrumentType:  inferInstrumentType(name),
          quantity,
          currentPriceGbp: effectivePrice,
          currentValueGbp: valueGbp,
          costBasisGbp:    costBasis,
          avgCostGbp,
          gainLossGbp,
          gainLossPct,
          currency:        'GBP',
          accountHolder,
        })
      }
    }

    // ── Add cash as holdings, one row per account holder ─────────────────────
    for (const [holder, amount] of cashByHolder) {
      holdings.push({
        symbol:          'CASH',
        name:            'Cash',
        instrumentType:  'cash',
        quantity:        1,
        currentPriceGbp: amount,
        currentValueGbp: amount,
        costBasisGbp:    amount,
        avgCostGbp:      amount,
        gainLossGbp:     0,
        gainLossPct:     0,
        currency:        'GBP',
        accountHolder:   holder,
      })
    }

    if (holdings.length === 0) {
      throw new Error(
        'No Investment ISA holdings found in CSV. ' +
        'Make sure this is a Fidelity "AccountSummary.csv" export.'
      )
    }

    // ── Deduplicate by (symbol, accountHolder) ───────────────────────────────
    // Same fund across multiple imports of the same ISA account gets merged.
    const merged = new Map<string, BrokerHolding>()
    for (const h of holdings) {
      const key = `${h.symbol}::${h.accountHolder ?? ''}`
      if (merged.has(key)) {
        const existing = merged.get(key)!
        existing.quantity        += h.quantity
        existing.currentValueGbp += h.currentValueGbp
        existing.costBasisGbp    += h.costBasisGbp
        existing.gainLossGbp     += h.gainLossGbp
        // Recalculate averages
        existing.currentPriceGbp = existing.quantity > 0
          ? existing.currentValueGbp / existing.quantity : 0
        existing.avgCostGbp = existing.quantity > 0
          ? existing.costBasisGbp / existing.quantity : 0
        existing.gainLossPct = existing.costBasisGbp > 0
          ? (existing.gainLossGbp / existing.costBasisGbp) * 100 : 0
      } else {
        merged.set(key, { ...h })
      }
    }

    const finalHoldings = Array.from(merged.values())
    const totalValueGbp = finalHoldings.reduce((s, h) => s + h.currentValueGbp, 0)
    const cashGbp       = finalHoldings
      .filter(h => h.instrumentType === 'cash')
      .reduce((s, h) => s + h.currentValueGbp, 0)

    return {
      broker:        'fidelity_uk',
      accountType:   'S&S ISA',
      totalValueGbp,
      cashGbp,
      holdings:      finalHoldings,
      asOfDate,
      importMethod:  'csv',
    }
  },
}
