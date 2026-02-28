export interface BrokerHolding {
  symbol: string
  name: string
  isin?: string
  sedol?: string
  instrumentType: 'etf' | 'stock' | 'fund' | 'bond' | 'cash' | 'investment_trust'
  quantity: number
  currentPriceGbp: number
  currentValueGbp: number
  costBasisGbp: number       // Total cost basis
  avgCostGbp: number         // Per-unit average cost
  gainLossGbp: number
  gainLossPct: number
  sector?: string
  currency: string
}

export interface BrokerPortfolio {
  broker: string
  accountType: string        // e.g. 'S&S ISA'
  totalValueGbp: number
  cashGbp: number
  holdings: BrokerHolding[]
  asOfDate: string           // ISO date string
  importMethod: 'csv' | 'api'
}

export interface BrokerAdapter {
  name: string
  parseImport(data: string | Buffer, format: string): Promise<BrokerPortfolio>
}
