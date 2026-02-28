import type { BrokerAdapter, BrokerPortfolio } from './types'

// Manual entry adapter — accepts pre-parsed JSON portfolio data
export const manualAdapter: BrokerAdapter = {
  name: 'manual',

  async parseImport(data: string): Promise<BrokerPortfolio> {
    try {
      const portfolio = JSON.parse(data) as BrokerPortfolio
      portfolio.importMethod = 'csv' // Treat manual entry same as CSV
      portfolio.broker = 'manual'
      return portfolio
    } catch {
      throw new Error('Manual import data must be valid JSON matching BrokerPortfolio schema')
    }
  },
}
