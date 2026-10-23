/**
 * Trading mini app backend. It mounts the chart/order-book API, public market-data stream bridge,
 * read-only market-data tool, and Localix chart-control tool. Credentialed account and order
 * capabilities are not registered by this entry point.
 */
import type { AgentTool } from '@localixai/agent/agents'
import type { MiniAppContext, MiniAppRegistration } from '@localixai/mini-app-sdk/backend'
import { bindStoreSecret, getTradingService } from './singleton'
import { createTradingRoutes } from './routes'
import { createTradingResourceProvider } from './resource-provider'
import { createTradingSearchProvider } from './search-provider'
import { createMarketDataTool, type MarketDataConnection } from './market-data'
import { createManageChartTool } from './manage-chart'
import { createTradingStreamRegistry } from './stream'
import { createTradingWsFrames } from './ws-frames'
import { DEFAULT_PUBLIC_EXCHANGE_ID, publicConnectionId } from './public-connection'
import { createTradingPublicContextProvider } from './context-provider'

/** The generic host capabilities this mini app reads off the register context. Declared
 *  narrowly (a structural subset of the host `MiniAppContext`) so the mini app stays decoupled
 *  from core mini app internals. Only the BOOT-time load carries `host`; the per-run tool load
 *  arrives without one, and the singleton's latest-real-host-wins binding covers it. */
type TradingRegisterContext = Pick<MiniAppContext, 'dataDir' | 'host' | 'userId'>

export async function register(ctx: TradingRegisterContext): Promise<MiniAppRegistration> {
  // The ONE host coupling — resolving `${secret:KEY}` credentials against the central vault —
  // arrives through the generic mini app host seam. Bind it into the process-wide singleton so a
  // per-run tool load (no host) still resolves secrets bound at boot. The create-only writer
  // (`setIfAbsent`) rides the same pass, so a pasted literal credential can be vaulted without
  // this mini app ever gaining overwrite access.
  const hostResolve = ctx.host?.resolveSecret
  const service = getTradingService({
    dataDir: ctx.dataDir,
    resolveSecret: hostResolve
      ? async (userId, key) => (await hostResolve(userId, key)) ?? null
      : undefined,
  })
  const hostStore = ctx.host?.storeSecret
  if (hostStore) bindStoreSecret((userId, key, value) => hostStore(userId, key, value))
  const userId = ctx.userId
  const streamRegistry = createTradingStreamRegistry({
    createStream: (connectionId) => service.buildStreamBackend(userId, connectionId),
  })

  // The venues this workbench reads. EPHEMERAL public profiles, nothing persisted and nothing
  // credentialed: the service establishes a `public:<exchange>` id lazily on the first read.
  // Named here so the agent tool reports a source rather than "no connection configured" and
  // falling back to raw `curl`.
  const publicConnections: MarketDataConnection[] = [
    {
      id: publicConnectionId(DEFAULT_PUBLIC_EXCHANGE_ID),
      name: `${DEFAULT_PUBLIC_EXCHANGE_ID} (public market data)`,
      exchangeId: DEFAULT_PUBLIC_EXCHANGE_ID,
      sandbox: false,
      readonly: true,
      connected: true,
    },
  ]
  const listMarketDataConnections = async (): Promise<MarketDataConnection[]> => publicConnections

  // market_data: READ-ONLY live market data over the public venues. The port exposes only read
  // methods, so the tool is structurally incapable of placing an order.
  const marketDataTool: AgentTool = createMarketDataTool({
    port: {
      listConnections: listMarketDataConnections,
      describe: (id) => service.describe(userId, id),
      markets: (id, opts) => service.markets(userId, id, opts),
      ticker: (id, symbol) => service.ticker(userId, id, symbol),
      tickers: (id, symbols) => service.tickers(userId, id, symbols),
      ohlcv: (id, symbol, timeframe, limit) =>
        service.ohlcv(userId, id, symbol, timeframe, { limit }),
      orderBook: (id, symbol, depth) => service.orderBook(userId, id, symbol, depth),
      fundingRate: (id, symbol) => service.fundingRate(userId, id, symbol),
      openInterest: (id, symbol) => service.openInterest(userId, id, symbol),
    },
  })

  // manage_chart: UI-only control of the Trading chart tab (open / timeframe / indicators /
  // chart type / navigate) over the generic live-data channel. Shares the market_data
  // connection roster so its default-venue resolution can never drift from the read tool's.
  const manageChartTool: AgentTool = createManageChartTool({
    port: {
      listConnections: listMarketDataConnections,
      // Candle reader for action='detect' — server-side pattern detection needs the data the
      // chart tab would otherwise be holding. Reads only; the tool draws via the command bus.
      ohlcv: (id, symbol, timeframe, limit) =>
        service.ohlcv(userId, id, symbol, timeframe, { limit }),
      // Funding for the detect scan's positioning read — same short-TTL-cached service read
      // the market panel uses; spot markets reject and detect omits the line.
      funding: (id, symbol) => service.fundingRate(userId, id, symbol),
      // One depth snapshot for the microstructure read (spread + top-of-book imbalance).
      orderBook: (id, symbol, limit) => service.orderBook(userId, id, symbol, limit),
    },
  })

  return {
    backend: [
      {
        id: 'trading:backend',
        routeMount: {
          path: '/rpc/trading',
          app: createTradingRoutes(service),
        },
        // READ-ONLY introspection surface: lets a chart / market view be dragged into chat as
        // a `@resource:localix://resource/trade/…` ref and reached via the composer `@`-menu + global search.
        // Public market data only — no credential accessor, no order/execution surface.
        resourceProvider: createTradingResourceProvider(service),
        contextProviders: [createTradingPublicContextProvider(service)],
        searchProvider: createTradingSearchProvider({
          listConnections: async () =>
            publicConnections.map((c) => ({
              id: c.id,
              name: c.name,
              exchangeId: c.exchangeId,
              connected: c.connected,
            })),
          listMarkets: async (id) =>
            (await service.markets(userId, id)).map((m) => ({
              symbol: m.symbol,
              base: m.base,
              quote: m.quote,
              type: m.type,
              active: m.active,
              ...(m.operator ? { operator: m.operator } : {}),
            })),
        }),
        wsFrames: createTradingWsFrames(streamRegistry),
        onShutdown: async () => {
          streamRegistry.stopAll()
          await service.closeAll()
        },
      },
    ],
    tools: [marketDataTool, manageChartTool],
  }
}
