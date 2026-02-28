import Papa from 'papaparse'
import type { BrokerAdapter, BrokerHolding, BrokerPortfolio } from './types'

// Fidelity UK CSV column names (may vary by export format)
const COLUMN_ALIASES: Record<string, string[]> = {
  name:        ['Stock', 'Security Name', 'Name', 'Description'],
  sedol:       ['SEDOL', 'Sedol'],
  isin:        ['ISIN'],
  units:       ['Units', 'Quantity', 'Shares'],
  price:       ['Price (p)', 'Price', 'Price (GBp)', 'Current Price'],
  value:       ['Value (£)', 'Value', 'Market Value (£)', 'Market Value'],
  costBasis:   ['Book Cost (£)', 'Book Cost', 'Cost (£)', 'Cost Basis'],
  gainLoss:    ['Gain/Loss (£)', 'Gain/Loss £', 'Unrealised Gain/Loss (£)'],
  gainLossPct: ['Gain/Loss (%)', 'Gain/Loss %', 'Unrealised Gain/Loss (%)'],
  account:     ['Account', 'Account Name', 'Account Type'],
  symbol:      ['Ticker', 'Symbol', 'Epic', 'TIDM'],
}

function findColumn(headers: string[], aliases: string[]): string | null {
  const normalized = headers.map(h => h.trim())
  for (const alias of aliases) {
    const match = normalized.find(h => h.toLowerCase() === alias.toLowerCase())
    if (match) return match
  }
  return null
}

function parseGbp(value: string | undefined | null): number {
  if (!value) return 0
  // Remove £, commas, whitespace
  const cleaned = String(value).replace(/[£,\s]/g, '').trim()
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

function parsePenceToGbp(value: string | undefined | null): number {
  // Fidelity often reports price in pence
  const pence = parseGbp(value)
  return pence / 100
}

function isPenceColumn(columnName: string): boolean {
  return columnName.toLowerCase().includes('(p)') ||
         columnName.toLowerCase().includes('gbp') ||
         columnName.toLowerCase().includes('pence')
}

function inferInstrumentType(name: string, sedol?: string): BrokerHolding['instrumentType'] {
  const lowerName = name.toLowerCase()
  if (lowerName.includes('etf') || lowerName.includes('exchange traded')) return 'etf'
  if (lowerName.includes('investment trust') || lowerName.includes('inv trust')) return 'investment_trust'
  if (lowerName.includes('fund') || lowerName.includes('feeder')) return 'fund'
  if (lowerName.includes('gilt') || lowerName.includes('bond') || lowerName.includes('treasury')) return 'bond'
  if (lowerName.includes('cash') || lowerName.includes('money market')) return 'cash'
  // SEDOL starting with B or higher is often a fund
  if (sedol && sedol.match(/^[B-Z]/i)) return 'fund'
  return 'stock'
}

function isIsaAccount(accountValue: string | undefined): boolean {
  if (!accountValue) return true // If no account column, assume ISA
  const lower = accountValue.toLowerCase()
  return lower.includes('isa') || lower.includes('stocks') || lower.includes('shares')
}

export const fidelityCsvAdapter: BrokerAdapter = {
  name: 'fidelity_uk',

  async parseImport(data: string): Promise<BrokerPortfolio> {
    const result = Papa.parse<Record<string, string>>(data, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
    })

    if (result.errors.length > 0) {
      const fatal = result.errors.filter(e => e.type === 'Delimiter' || e.type === 'Quotes')
      if (fatal.length > 0) {
        throw new Error(`CSV parse error: ${fatal[0].message}`)
      }
    }

    const rows = result.data
    if (rows.length === 0) {
      throw new Error('CSV file appears to be empty or has no data rows')
    }

    const headers = Object.keys(rows[0])

    // Resolve columns
    const colName     = findColumn(headers, COLUMN_ALIASES.name)
    const colSedol    = findColumn(headers, COLUMN_ALIASES.sedol)
    const colIsin     = findColumn(headers, COLUMN_ALIASES.isin)
    const colUnits    = findColumn(headers, COLUMN_ALIASES.units)
    const colPrice    = findColumn(headers, COLUMN_ALIASES.price)
    const colValue    = findColumn(headers, COLUMN_ALIASES.value)
    const colCost     = findColumn(headers, COLUMN_ALIASES.costBasis)
    const colGainLoss = findColumn(headers, COLUMN_ALIASES.gainLoss)
    const colGainPct  = findColumn(headers, COLUMN_ALIASES.gainLossPct)
    const colAccount  = findColumn(headers, COLUMN_ALIASES.account)
    const colSymbol   = findColumn(headers, COLUMN_ALIASES.symbol)

    if (!colName || !colValue) {
      throw new Error(
        `Could not find required columns in CSV. Expected "Stock/Name" and "Value". ` +
        `Found: ${headers.join(', ')}`
      )
    }

    const priceIsPence = colPrice ? isPenceColumn(colPrice) : false

    const holdings: BrokerHolding[] = []
    let totalValueGbp = 0
    let cashGbp = 0
    const asOfDate = new Date().toISOString().split('T')[0]

    for (const row of rows) {
      const accountValue = colAccount ? row[colAccount] : undefined

      // Filter to ISA account only
      if (!isIsaAccount(accountValue)) continue

      const name = colName ? (row[colName] || '').trim() : ''
      if (!name) continue

      const valueGbp = parseGbp(colValue ? row[colValue] : '0')
      const costGbp  = parseGbp(colCost ? row[colCost] : '0')
      const units    = parseFloat((colUnits ? row[colUnits] : '0') || '0') || 0

      // Cash row detection
      const lowerName = name.toLowerCase()
      if (lowerName.includes('cash') || lowerName.includes('money market') || lowerName.includes('gbp cash')) {
        cashGbp += valueGbp
        continue
      }

      const rawPrice = colPrice ? row[colPrice] : ''
      const priceGbp = priceIsPence ? parsePenceToGbp(rawPrice) : parseGbp(rawPrice)
      const effectivePriceGbp = priceGbp > 0 ? priceGbp : (units > 0 ? valueGbp / units : 0)

      const gainLossGbp = parseGbp(colGainLoss ? row[colGainLoss] : '0')
      const gainLossPct = parseFloat(
        (colGainPct ? row[colGainPct] : '0')?.replace('%', '') || '0'
      ) || 0

      const sedol  = colSedol  ? (row[colSedol] || '').trim()  : undefined
      const isin   = colIsin   ? (row[colIsin] || '').trim()   : undefined
      // Fidelity often doesn't include ticker — use SEDOL as fallback symbol
      const symbol = colSymbol ? (row[colSymbol] || '').trim() : (sedol || name.slice(0, 12).replace(/\s+/g, '_').toUpperCase())

      const avgCostGbp = units > 0 && costGbp > 0 ? costGbp / units : effectivePriceGbp

      holdings.push({
        symbol,
        name,
        isin:             isin || undefined,
        sedol:            sedol || undefined,
        instrumentType:   inferInstrumentType(name, sedol),
        quantity:         units,
        currentPriceGbp:  effectivePriceGbp,
        currentValueGbp:  valueGbp,
        costBasisGbp:     costGbp,
        avgCostGbp,
        gainLossGbp,
        gainLossPct,
        currency:         'GBP',
      })

      totalValueGbp += valueGbp
    }

    if (holdings.length === 0) {
      throw new Error(
        'No holdings found in CSV. Ensure this is a Fidelity ISA portfolio export and try again.'
      )
    }

    return {
      broker:        'fidelity_uk',
      accountType:   'S&S ISA',
      totalValueGbp: totalValueGbp + cashGbp,
      cashGbp,
      holdings,
      asOfDate,
      importMethod:  'csv',
    }
  },
}
