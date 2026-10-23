/**
 * The trading workbench's live streams expressed as a generic {@link WsFrameContribution}
 * — the same de-hardcoded seam the Kubernetes pod-watch uses. A `trading:watch.subscribe`
 * command opens a per-`(connectionId, channel, symbol, timeframe)` stream whose frames are
 * pushed as `m\n<json>`; a `trading:watch.unsubscribe` (or socket close) tears it down.
 * Core's `realtime/ws.ts` consults the `WsFrameRegistry` for these otherwise-unrecognized
 * commands, so no trading literal lives in core.
 *
 * NOTE ON REFCOUNTING — two independent layers, both intended:
 *  - the ws-frame-registry refcounts per `(subscribeCommand, key)` per SOCKET (several
 *    client subscribers on one tab share one `start`);
 *  - the {@link TradingStreamRegistry} refcounts per PROCESS across sockets (several tabs
 *    watching the same market share ONE ccxt.pro loop + client).
 */
import type { WsFrameContribution } from '@localixai/mini-app-sdk/backend'
import type { StreamChannel, StreamParams } from './backend'
import { type TradingStreamRegistry, streamKeyOf } from './stream'

/** The PUBLIC market-data channels only. The private account set (orders / positions /
 *  balance / myTrades) is deliberately NOT accepted here — this mini app's surface streams no
 *  account state (see `index.ts`); the private channels return when the account surface
 *  registers its own contribution. */
const CHANNELS: readonly StreamChannel[] = ['ticker', 'ohlcv', 'orderbook', 'trades']

/** Parse the raw command envelope into a connection id + validated stream params. */
function readEnvelope(
  raw: Record<string, unknown>,
): { connectionId: string; params: StreamParams } | null {
  const connectionId = typeof raw.connectionId === 'string' ? raw.connectionId : ''
  const channel = raw.channel
  if (
    !connectionId ||
    typeof channel !== 'string' ||
    !(CHANNELS as readonly string[]).includes(channel)
  )
    return null
  return {
    connectionId,
    params: {
      channel: channel as StreamChannel,
      symbol: typeof raw.symbol === 'string' ? raw.symbol : undefined,
      timeframe: typeof raw.timeframe === 'string' ? raw.timeframe : undefined,
    },
  }
}

/**
 * The trading live-stream contribution(s). `frameTag` is `'m'` (market data) — distinct
 * from the reserved `s` (session firehose), `k` (kanban), `r` (rpc), and `w` (k8s watch).
 * The `handle` returned by `start` is the registry's unsubscribe closure, invoked by `stop`.
 */
export function createTradingWsFrames(registry: TradingStreamRegistry): WsFrameContribution[] {
  const contribution: WsFrameContribution = {
    subscribeCommand: 'trading:watch.subscribe',
    unsubscribeCommand: 'trading:watch.unsubscribe',
    frameTag: 'm',
    key: (params) => {
      const env = readEnvelope(params)
      return env ? streamKeyOf(env.connectionId, env.params) : 'invalid'
    },
    start: (params, send) => {
      const env = readEnvelope(params)
      if (!env) return () => {}
      return registry.subscribe(env.connectionId, env.params, {
        onFrame: (frame) => send(JSON.stringify(frame)),
      })
    },
    stop: (handle) => {
      if (typeof handle === 'function') (handle as () => void)()
    },
  }
  return [contribution]
}
