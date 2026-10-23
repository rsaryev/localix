// Client side of the trading live streams, over the SDK's realtime feed — which owns the frame
// demux, the per-key refcount, the re-subscribe on reconnect and the pause while hidden, so the
// market feeds do not each re-implement them.
//
// Frames arrive on the `m` frame tag (the mini app's `WsFrameContribution`, distinct from the
// reserved s/k/r and the k8s `w`); subscribe/unsubscribe ride the `trading:watch.subscribe`
// / `trading:watch.unsubscribe` WS commands. All sends are best-effort — a failed subscribe
// just leaves the caller's REST poll fallback in charge.
//
// TWO refcount layers cooperate (both intended): the ws-frame-registry refcounts per
// `(subscribeCommand, key)` per SOCKET, and the feed refcounts per stream key across
// React subscribers on the tab — so the chart header and (future) order-book panel both
// wanting the ticker share ONE server subscribe and ONE frame parse.
//
// Wire note: a DATA frame carries `channel` + `symbol` (+ `timeframe` inside an ohlcv
// payload), so it is routed precisely for a single chart tab. A STATUS frame carries no
// stream discriminator, so it is fanned to every active stream — safe because the backend
// pools ONE venue websocket per connection (a tab's channels share liveness) and status is
// only advisory (a spurious `down` just resumes an always-correct REST poll; `live` is also
// proven by data arrival).
import { createRealtimeFeed } from '@localixai/mini-app-sdk/ui/realtime-feed'
import type { StreamChannel, StreamPayload } from '../../backend/backend'
import type { StreamStatus, TradingStreamFrame } from '../../backend/stream'

export interface TradingStreamParams {
  connectionId: string
  channel: StreamChannel
  symbol?: string
  timeframe?: string
}

export interface TradingStreamHandlers {
  /** One already-normalized push update for this stream. */
  onData: (payload: StreamPayload) => void
  /** Liveness change — also 'down' when the socket drops, on tab-hide and on WS reconnect. */
  onStatus?: (status: StreamStatus) => void
  /** After a WS reconnect (a new socket drops the server-side subscription) or a hidden tab
   *  shown again re-subscribes, so the caller can REST-resync anything missed across the gap. */
  onReconnect?: () => void
}

/** Stable per-stream key (mirrors the backend `streamKeyOf`). Pure. */
export function tradingStreamKey(p: TradingStreamParams): string {
  return [p.connectionId, p.channel, p.symbol ?? '', p.timeframe ?? ''].join('\n')
}

type DataFrame = Extract<TradingStreamFrame, { kind: 'data' }>

/** Does a data frame belong to a stream? Routed by channel + symbol (+ ohlcv timeframe) —
 *  the only discriminators the wire carries. Pure. */
export function frameMatchesStream(p: TradingStreamParams, frame: DataFrame): boolean {
  if (frame.channel !== p.channel) return false
  if (p.symbol !== undefined && frame.symbol !== p.symbol) return false
  if (p.channel === 'ohlcv' && p.timeframe !== undefined && frame.payload.channel === 'ohlcv') {
    return frame.payload.timeframe === p.timeframe
  }
  return true
}

const command = (t: string, p: TradingStreamParams) => ({
  t,
  connectionId: p.connectionId,
  channel: p.channel,
  symbol: p.symbol,
  timeframe: p.timeframe,
})

/**
 * Every stream is paused while the document is hidden and resumed (with a re-read) when it is
 * shown: each key holds a venue socket, and the caller's REST poll is paused in the same window.
 */
const tradingFeed = createRealtimeFeed<TradingStreamParams, TradingStreamFrame>({
  tag: 'm',
  subscribe: (p) => command('trading:watch.subscribe', p),
  unsubscribe: (p) => command('trading:watch.unsubscribe', p),
  id: tradingStreamKey,
  decode: (json) => JSON.parse(json) as TradingStreamFrame,
  route: (frame) =>
    frame.kind === 'status' ? null : (params) => frameMatchesStream(params, frame),
  status: (frame) => (frame.kind === 'status' ? frame.status === 'live' : undefined),
  pauseWhileHidden: true,
})

/**
 * Subscribe to a live trading stream. The first subscriber for a key starts the server-side
 * stream (when the tab is visible); the last to leave tears it down. Returns an unsubscribe
 * that detaches the handler and releases the shared stream.
 */
export function subscribeTradingStream(
  params: TradingStreamParams,
  handlers: TradingStreamHandlers,
): () => void {
  return tradingFeed.follow(params, {
    frame: (frame) => {
      if (frame.kind === 'data') handlers.onData(frame.payload)
    },
    live: (live) => handlers.onStatus?.(live ? 'live' : 'down'),
    // `down` again even when the feed already said so: data proves `live` to the caller without
    // a status frame, so the feed's own flag can be false while the caller's is true.
    reconnect: () => {
      handlers.onStatus?.('down')
      handlers.onReconnect?.()
    },
  })
}
