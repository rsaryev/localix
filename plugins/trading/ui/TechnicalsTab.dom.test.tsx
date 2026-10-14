import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import '@localixai/kit/testing/host-runtime'
import type { Candle } from '../backend/contracts'
import { registerDom } from '@localixai/kit/testing'

/**
 * What this page costs the venue is worth pinning: the exchange rate-limits on ONE serial queue,
 * so every avoidable read delays the one the user is actually waiting for.
 *
 * Two claims:
 *  - the cross-timeframe strip does not re-read the timeframe already on screen (its rating is
 *    computed here and handed to the strip's cache), and
 *  - the strip's background reads wait for THIS page's own history to land.
 */

let teardown: () => Promise<void>
let originalFetch: typeof fetch
/** Every ohlcv read, in order: `<timeframe>@<limit>`. */
let reads: string[] = []
/** Held until a test releases them, so "did it wait?" is observable. */
let gate: { release: () => void; promise: Promise<void> }

function tape(n: number): Candle[] {
  let seed = 11
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648)
  const out: Candle[] = []
  let close = 100
  for (let i = 0; i < n; i++) {
    const open = close
    close = Math.max(1, close * (1 + (rnd() - 0.5) * 0.02))
    out.push({
      time: 1_700_000_000 + i * 3600,
      open,
      close,
      high: Math.max(open, close) * 1.004,
      low: Math.min(open, close) * 0.996,
      volume: 10,
    })
  }
  return out
}

const CANDLES = tape(300)

function newGate() {
  let release = () => {}
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { release, promise }
}

/** The live-candle stream is not what this test is about; a socket that never opens keeps the
 *  page on its REST path (which is exactly what a venue without a stream looks like). */
class SilentSocket {
  static readonly CONNECTING = 0
  readonly readyState = 0
  close() {}
  send() {}
  addEventListener() {}
  removeEventListener() {}
}

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // happy-dom starts on `about:blank`, whose origin is not a URL the API base can be derived
  // from — the shared client reads `window.location.origin` at import time and the stream client
  // then builds a `ws://` URL out of it. Give the document a real origin before anything imports.
  ;(globalThis as { happyDOM?: { setURL?: (url: string) => void } }).happyDOM?.setURL?.(
    'http://localhost:5050/',
  )
  ;(globalThis as { WebSocket?: unknown }).WebSocket = SilentSocket
  originalFetch = globalThis.fetch
  globalThis.fetch = (async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    if (url.includes('/ohlcv')) {
      const params = new URL(url, 'http://x').searchParams
      const timeframe = params.get('timeframe') ?? '?'
      reads.push(`${timeframe}@${params.get('limit') ?? '-'}`)
      // The PRIMARY read (the page's own history) is the gated one.
      if (timeframe === '1h' && params.get('limit') !== '260') await gate.promise
      return json({ symbol: 'BTC/USDT', timeframe, candles: CANDLES })
    }
    if (url.includes('/funding')) return json({ funding: null })
    return json({})
  }) as typeof fetch
})

afterEach(() => {
  reads = []
})

afterAll(async () => {
  globalThis.fetch = originalFetch
  await teardown()
})

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

describe('TechnicalsTab venue reads', () => {
  test('the alignment strip waits for the page rating, then skips the active timeframe', async () => {
    gate = newGate()
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { TechnicalsTab } = await import('./TechnicalsTab')
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(<TechnicalsTab connectionId="public:binance" symbol="BTC/USDT" />)
        await settle()
      })

      // The primary read is still in flight: no background timeframe has been asked for.
      expect(reads.filter((r) => !r.startsWith('1h@'))).toEqual([])

      await act(async () => {
        gate.release()
        await settle(40)
      })

      // Now the other four timeframes are read — and 1h is NOT among them: its verdict came
      // from the rating this page already computed.
      const strip = reads.filter((r) => r.endsWith('@260'))
      expect(strip.sort()).toEqual(['15m@260', '1d@260', '4h@260', '5m@260'])
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
