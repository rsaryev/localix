import type { ContextProviderContribution } from '@localixai/mini-app-sdk/backend'
import { createResourceContextProvider } from '@localixai/mini-app-sdk/backend'
import { createTradingResourceProvider, type ResourceTradingService } from './resource-provider'
import { parseTradeUri } from './uri'
import { publicExchangeId } from './public-connection'

/**
 * A `localix://resource/trade` URI the fabric is allowed to read: it must parse, and it must name an
 * EPHEMERAL public exchange profile. Saved credentialed connections and account leaves
 * (balances, positions, orders) therefore fail this gate.
 */
function isPublicMarketData(uri: string): boolean {
  const node = parseTradeUri(uri)
  return node !== null && publicExchangeId(node.connectionId) !== null
}

/**
 * Explicit Context Fabric adapter for the public market-data subtree only. Account
 * leaves and saved credentialed connections stay excluded until their
 * ownership, consent and financial-data sensitivity policy is specified separately.
 *
 * SAFETY: `accepts` is the gate that enforces that boundary, and the factory applies it
 * on EVERY entry point — `supports`, `estimate` and `resolve` — so an account reference
 * can never be sized, captured, or even read through the expander. This is a widening of
 * the guarantee: the hand-rolled resolver this replaces omitted the check in `estimate`.
 *
 * The provider is NOT passed: the factory derives it from the expander, which is this
 * mini app's own `ResourceRefProvider` and therefore the authority on its provider namespace.
 */
export function createTradingPublicContextProvider(
  service: ResourceTradingService,
): ContextProviderContribution {
  return createResourceContextProvider({
    id: 'trading:public-context',
    namespace: 'trading-public',
    accepts: isPublicMarketData,
    kind: () => 'trading-public-market-data',
    revisionPrefix: 'trade-public-content',
    sensitivity: 'public',
    expander: createTradingResourceProvider(service),
    // A market expansion is a LIVE exchange read over a lazily-established public
    // connection — a full market load plus a quote. The 1.5s factory default is a
    // local-read budget and cannot cover a cold one, and the per-provider timeout
    // caps each call independently of the caller's deadline: leaving it at the
    // default would silently re-impose 1.5s no matter how long the caller waits.
    timeoutMs: 5_000,
    // Market and candle expansions are verbose tables. The 2k-token default quota
    // dropped them as `provider_quota` AFTER paying for the read. 8k matches the
    // 32_000-byte budget the chat capture itself allocates (8k × 4), so this
    // provider's own quota no longer binds tighter than the turn that requested it.
    maxTokens: 8_000,
  })
}
