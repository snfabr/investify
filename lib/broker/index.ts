import type { BrokerAdapter } from './types'
import { fidelityCsvAdapter } from './fidelity-csv'
import { manualAdapter } from './manual'

const adapters: Record<string, BrokerAdapter> = {
  fidelity_uk: fidelityCsvAdapter,
  manual:      manualAdapter,
}

export function getAdapter(brokerName: string): BrokerAdapter {
  const adapter = adapters[brokerName]
  if (!adapter) {
    throw new Error(
      `Unknown broker: "${brokerName}". Supported brokers: ${Object.keys(adapters).join(', ')}`
    )
  }
  return adapter
}

export type { BrokerAdapter, BrokerHolding, BrokerPortfolio } from './types'
