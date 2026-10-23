import type { TradingConnectionConfig } from './contracts'

/** Public market-data profiles are ephemeral: they never carry credentials or touch the user's
 * persisted connection list. Hyperliquid is the initial source; any catalog exchange can be
 * addressed through the same safe, read-only shape when the user switches venues. */
export const DEFAULT_PUBLIC_EXCHANGE_ID = 'hyperliquid'

const PUBLIC_CONNECTION_PREFIX = 'public:'

export function publicConnectionId(exchangeId: string): string {
  return `${PUBLIC_CONNECTION_PREFIX}${exchangeId}`
}

export function publicExchangeId(connectionId: string): string | null {
  if (!connectionId.startsWith(PUBLIC_CONNECTION_PREFIX)) return null
  const exchangeId = connectionId.slice(PUBLIC_CONNECTION_PREFIX.length)
  return /^[a-z0-9_-]+$/i.test(exchangeId) ? exchangeId : null
}

export function publicConnectionConfig(exchangeId: string): TradingConnectionConfig {
  return {
    exchangeId,
    readonly: true,
    // Keep the agent gate closed as defence in depth: a public profile is market data only.
    risk: { agentTrading: 'off' },
  }
}
