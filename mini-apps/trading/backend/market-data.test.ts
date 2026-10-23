import { describe, expect, it } from 'bun:test'
import {
  createMarketDataTool,
  type MarketDataPort,
  type MarketDataConnection,
  type MarketDataMarket,
} from './market-data'
import { candleSummary, trendLine } from './candle-lines'
import { quoteRow } from './market-data-render'
import { exchangeCapabilities } from './testing/test-fixtures'

const conn = (over: Partial<MarketDataConnection> = {}): MarketDataConnection => ({
  id: 'c1',
  name: 'hl-main',
  exchangeId: 'demoex',
  sandbox: false,
  readonly: true,
  connected: true,
  ...over,
})

function port(over: Partial<MarketDataPort> = {}): MarketDataPort {
  return {
    listConnections: async () => [conn()],
    describe: async () => ({
      id: 'demoex',
      name: 'DemoEx',
      timeframes: ['1m', '1h', '1d'],
      precisionMode: 'tick',
      capabilities: exchangeCapabilities({
        ohlcv: true,
        orderBook: true,
        trades: true,
        ticker: 'native',
        watch: false,
        // An OperationSupport member: a string, not a boolean — `'none'` is truthy, which is the
        // trap `supportedCapabilities` exists to avoid.
        fundingRate: 'emulated',
      }),
    }),
    markets: async () => [
      {
        symbol: 'BTC/USDC:USDC',
        base: 'BTC',
        quote: 'USDC',
        type: 'swap',
        active: true,
        // Hyperliquid: a contract market whose contract IS one BTC.
        contract: true,
        contractSize: 1,
        precision: { price: 1, amount: 0.00001 },
        limits: { minAmount: 0.0001, minCost: 10, maxLeverage: 40 },
      },
    ],
    ticker: async () => ({
      symbol: 'BTC/USDC:USDC',
      last: 65000,
      bid: 64999,
      ask: 65001,
      high: 66000,
      low: 64000,
      baseVolume: 1234,
      change: 0.031,
    }),
    ohlcv: async () => [
      { time: 1_700_000_000, open: 64000, high: 65200, low: 63900, close: 65000, volume: 12 },
    ],
    orderBook: async () => ({ bids: [[64999, 1.5]], asks: [[65001, 2]] }),
    ...over,
  }
}

const run = (p: MarketDataPort, input: Record<string, unknown>) =>
  createMarketDataTool({ port: p }).execute('t', input)

describe('market_data tool', () => {
  it('lists connections with no arguments', async () => {
    const r = await run(port(), {})
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('hl-main [demoex]')
    expect(r.content).toContain('read-only')
  })

  it('surfaces an unavailable service as a clean error', async () => {
    const r = await run(
      port({
        listConnections: async () => {
          throw new Error('offline')
        },
      }),
      {},
    )
    expect(r.isError).toBe(true)
    expect(r.content).toContain('Trading is not available')
  })

  it('reports capabilities + markets for a connection', async () => {
    const r = await run(port(), { connection_id: 'c1' })
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('DemoEx')
    expect(r.content).toContain('1h')
    expect(r.content).toContain('BTC/USDC:USDC [swap]')
  })

  /**
   * `e550f0cb1` removed trading from this mini app — "a removal, not a gate": no order path, no
   * credential field, no account client. The ccxt driver is now built WITHOUT credentials, so a
   * private call cannot even authenticate. But the venue report kept probing and printing the whole
   * account/order family, and this line goes to the MODEL: `supports: … balance, positions,
   * openOrders, createOrder, cancelOrder, …`. An agent asked to place an order reads that as a yes.
   *
   * The guarantee is structural rather than a filter: those keys are gone from
   * `ExchangeInfo['capabilities']`, so no probe can put them back and no renderer can print them.
   * Asserted on the STRING, which survives the type change and keeps this test meaningful.
   */
  it('advertises no account or order operation — this mini app cannot trade', async () => {
    const r = await run(port(), { connection_id: 'c1' })
    const supports = /supports: (.*)/.exec(r.content)?.[1]
    expect(supports, 'the venue report must still have a supports line').toBeDefined()
    for (const forbidden of [
      'balance',
      'positions',
      'openOrders',
      'myTrades',
      'fetchOrder',
      'fetchClosedOrders',
      'createOrder',
      'cancelOrder',
      'closePosition',
      'cancelAllOrders',
      'triggerOrders',
      'takeProfitStopLoss',
      'setLeverage',
      'setMarginMode',
      'editOrder',
      'fundingHistory',
    ]) {
      expect(supports, `${forbidden} is not a capability this mini app can honour`).not.toContain(
        forbidden,
      )
    }
    // …and the research reads are still reported, so this is a removal and not a blanket silence.
    expect(supports).toContain('ohlcv')
    expect(supports).toContain('orderBook')
  })

  it('quotes a symbol with ticker, candles and top-of-book', async () => {
    const r = await run(port(), { connection_id: 'c1', symbol: 'BTC/USDC:USDC' })
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('last 65000')
    expect(r.content).toContain('3.10% 24h')
    expect(r.content).toContain('1h candle')
    expect(r.content).toContain('bids (price × size BTC): 64999 × 1.5')
    // The spread is the cheapest liquidity signal — bestAsk 65001 − bestBid 64999 = 2, mid 65000.
    expect(r.content).toContain('spread: 2 (0.3 bps of mid 65000)')
  })

  it('omits the spread line when one side of the book is empty', async () => {
    const p = port({
      orderBook: async () => ({ bids: [[100, 1]] as Array<[number, number]>, asks: [] }),
    })
    const r = await run(p, { connection_id: 'c1', symbol: 'BTC/USDC:USDC' })
    expect(r.content).not.toContain('spread:')
  })

  it('reports resting depth on each side as a buy/sell-pressure read', async () => {
    const p = port({
      orderBook: async () => ({
        bids: [[100, 8]] as Array<[number, number]>,
        asks: [[101, 2]] as Array<[number, number]>,
      }),
    })
    const r = await run(p, { connection_id: 'c1', symbol: 'BTC/USDC:USDC' })
    // bids Σ8, asks Σ2 → 80% bids.
    expect(r.content).toMatch(/depth \(top \d+ BTC\): bids 8 · asks 2 — 80% bids/)
  })

  it('omits the depth line when neither side has usable size', async () => {
    const p = port({
      orderBook: async () => ({
        bids: [] as Array<[number, number]>,
        asks: [] as Array<[number, number]>,
      }),
    })
    const r = await run(p, { connection_id: 'c1', symbol: 'BTC/USDC:USDC' })
    expect(r.content).not.toContain('depth (top')
  })

  it('funding shows an absolute time AND a relative countdown so the agent knows if it is imminent', async () => {
    const nextFundingTime = Date.now() + 2 * 3600_000 + 13 * 60_000 + 30_000
    const p = port({ fundingRate: async () => ({ rate: 0.0001, interval: '1h', nextFundingTime }) })
    const r = await run(p, { connection_id: 'c1', symbol: 'BTC/USDC:USDC' })
    expect(r.content).toContain(`next ${new Date(nextFundingTime).toISOString()}`)
    expect(r.content).toMatch(/\(in 2h \d\dm\)/)
  })

  it('funding with no next-settlement time shows no countdown, not a stale one', async () => {
    const p = port({ fundingRate: async () => ({ rate: 0.0001, interval: '1h' }) })
    const r = await run(p, { connection_id: 'c1', symbol: 'BTC/USDC:USDC' })
    expect(r.content).toContain('funding: 0.01%')
    expect(r.content).not.toContain('(in ')
  })

  describe('slippage — what a MARKET order of this size would actually pay', () => {
    const deepBook = {
      bids: [
        [100, 1],
        [99, 5],
      ] as Array<[number, number]>,
      asks: [
        [100, 1],
        [101, 1],
        [102, 10],
      ] as Array<[number, number]>,
    }
    const withBook = () => port({ orderBook: async () => deepBook })

    it('walks the asks for a buy and reports the average fill and how much worse it is', async () => {
      const r = await run(withBook(), {
        connection_id: 'c1',
        symbol: 'BTC/USDC:USDC',
        size: 2,
        side: 'buy',
      })
      // 1 @ 100 + 1 @ 101 = avg 100.5, 0.5% worse than the best ask of 100.
      expect(r.content).toContain('taking 2 BTC with a market buy')
      expect(r.content).toContain('avg fill 100.5')
      expect(r.content).toContain('0.500% worse than the best ask 100')
    })

    it('a size past the VISIBLE depth reports a LOWER BOUND, never a cheap number', async () => {
      const r = await run(withBook(), {
        connection_id: 'c1',
        symbol: 'BTC/USDC:USDC',
        size: 50,
        side: 'sell',
      })
      expect(r.content).toContain('LOWER BOUND')
      expect(r.content).toContain('only fills 6 BTC of 50 BTC')
    })

    it('a size with no side is not an order — it refuses to guess a direction', async () => {
      const r = await run(withBook(), { connection_id: 'c1', symbol: 'BTC/USDC:USDC', size: 2 })
      expect(r.content).toContain('needs a `side`')
      expect(r.content).not.toContain('avg fill')
    })

    it('an unreadable book gives NO estimate and says not to assume it is cheap', async () => {
      const p = port({
        orderBook: async () => {
          throw new Error('venue unreachable')
        },
      })
      const r = await run(p, { connection_id: 'c1', symbol: 'BTC/USDC:USDC', size: 2, side: 'buy' })
      expect(r.content).toContain('order book unavailable')
      expect(r.content).toContain('do NOT assume it is cheap')
    })

    it('an empty book side gives no estimate, never 0%', async () => {
      const p = port({
        orderBook: async () => ({ bids: [[100, 1]] as Array<[number, number]>, asks: [] }),
      })
      const r = await run(p, { connection_id: 'c1', symbol: 'BTC/USDC:USDC', size: 2, side: 'buy' })
      expect(r.content).toContain('the ask side of the book is empty')
      expect(r.content).not.toContain('0.000%')
    })

    it('no size, no estimate — the book is still printed', async () => {
      const r = await run(withBook(), { connection_id: 'c1', symbol: 'BTC/USDC:USDC' })
      expect(r.content).toContain('asks (price × size BTC)')
      expect(r.content).not.toContain('avg fill')
    })
  })

  describe('unit cost — the line that stops `balance / price` sizing', () => {
    const mk = (over: Partial<MarketDataMarket> = {}): MarketDataMarket => ({
      symbol: 'BTC/USDC:USDC',
      base: 'BTC',
      quote: 'USDC',
      type: 'swap',
      active: true,
      contract: true,
      contractSize: 1,
      linear: true,
      precision: {},
      limits: {},
      ...over,
    })
    const at = (market: MarketDataMarket, last: number | undefined) =>
      run(
        port({
          markets: async () => [market],
          ticker: async () => ({ symbol: 'BTC/USDC:USDC', last }),
        }),
        {
          connection_id: 'c1',
          symbol: 'BTC/USDC:USDC',
        },
      )

    it('a contract that IS one base unit values at the price', async () => {
      const r = await at(mk({}), 64000)
      expect(r.content).toContain('1 BTC ≈ 64000 USDC at the last price')
      expect(r.content).toContain('never by the price')
    })

    it('a 0.01-size contract values at a HUNDREDTH of the price — the whole point', async () => {
      // `10000 / 64000` would submit 0.156 contracts where 15.6 were meant.
      const r = await at(mk({ contractSize: 0.01 }), 64000)
      expect(r.content).toContain('1 cont ≈ 640 USDC at the last price')
    })

    it('an INVERSE contract does not take the price into its value at all', async () => {
      const r = await at(mk({ contractSize: 100, linear: false }), 64000)
      expect(r.content).toContain('1 cont ≈ 100 USDC at the last price')
      expect(r.content).not.toContain('6400000')
    })

    it('an unclassified contract says it cannot be valued, and forbids the fallback', async () => {
      const r = await at(mk({ linear: undefined }), 64000)
      expect(r.content).toContain('one unit of size cannot be valued')
      expect(r.content).toContain('do NOT size by dividing a balance by the price')
    })

    it('no reference price, no line — never a value computed from nothing', async () => {
      const r = await at(mk({}), undefined)
      expect(r.content).not.toContain('at the last price')
      expect(r.content).not.toContain('cannot be valued')
    })
  })

  describe('fees — the cost of trading, which silence would read as free', () => {
    const feeMarket = (fees?: { maker?: number; taker?: number }) => ({
      symbol: 'BTC/USDC:USDC',
      base: 'BTC',
      quote: 'USDC',
      type: 'swap',
      active: true,
      contract: true,
      contractSize: 1,
      linear: true,
      precision: {},
      limits: {},
      fees,
    })

    it('the order constraints name both fee sides', async () => {
      const p = port({ markets: async () => [feeMarket({ maker: 0.0001, taker: 0.00045 })] })
      const r = await run(p, { connection_id: 'c1', symbol: 'BTC/USDC:USDC' })
      expect(r.content).toContain('fees: maker 0.01% · taker 0.045% (a market order pays taker)')
    })

    it('a venue that reports NO fees says so — an omitted line would read as free', async () => {
      const p = port({ markets: async () => [feeMarket(undefined)] })
      const r = await run(p, { connection_id: 'c1', symbol: 'BTC/USDC:USDC' })
      expect(r.content).toContain('do NOT assume this market is free to trade')
    })

    it('a sized market order quotes the taker fee it would actually pay', async () => {
      const p = port({
        markets: async () => [feeMarket({ taker: 0.001 })],
        orderBook: async () => ({
          bids: [[100, 5]] as Array<[number, number]>,
          asks: [[100, 5]] as Array<[number, number]>,
        }),
      })
      const r = await run(p, { connection_id: 'c1', symbol: 'BTC/USDC:USDC', size: 2, side: 'buy' })
      // 2 BTC filled at 100 = 200 USDC notional × 0.1% = 0.2 USDC.
      expect(r.content).toContain('est. taker fee on the filled 2 BTC: 0.2 USDC (0.1%)')
    })

    it('a contract market the venue never classified cannot be valued — no fee estimate', async () => {
      // `notionalOf` refuses an unsized/unclassified contract: `amount × price` is off by
      // `contractSize` and by linearity. A fee guessed off a wrong notional is worse than none.
      const unclassified = { ...feeMarket({ taker: 0.001 }), linear: undefined }
      const p = port({
        markets: async () => [unclassified],
        orderBook: async () => ({
          bids: [[100, 5]] as Array<[number, number]>,
          asks: [[100, 5]] as Array<[number, number]>,
        }),
      })
      const r = await run(p, { connection_id: 'c1', symbol: 'BTC/USDC:USDC', size: 2, side: 'buy' })
      expect(r.content).toContain('avg fill 100')
      expect(r.content).not.toContain('taker fee')
    })

    it('an UNREPORTED taker rate prints no fee estimate — never a comforting zero', async () => {
      const p = port({
        markets: async () => [feeMarket({ maker: 0.0001 })],
        orderBook: async () => ({
          bids: [[100, 5]] as Array<[number, number]>,
          asks: [[100, 5]] as Array<[number, number]>,
        }),
      })
      const r = await run(p, { connection_id: 'c1', symbol: 'BTC/USDC:USDC', size: 2, side: 'buy' })
      expect(r.content).toContain('avg fill 100')
      expect(r.content).not.toContain('taker fee')
    })
  })

  it('errors on an unknown connection', async () => {
    const r = await run(port(), { connection_id: 'nope' })
    expect(r.isError).toBe(true)
    expect(r.content).toContain('No trading connection')
  })

  it('errors on a disconnected connection', async () => {
    const r = await run(port({ listConnections: async () => [conn({ connected: false })] }), {
      connection_id: 'c1',
      symbol: 'BTC/USDC:USDC',
    })
    expect(r.isError).toBe(true)
    expect(r.content).toContain('not connected')
  })

  // ── Order constraints: what the agent needs BEFORE it submits ─────────────

  it('never reports a "none" capability as supported', async () => {
    // `'none'` is a truthy string — a naive truthiness filter would promise it. The fixture leaves
    // `openInterest` off and `ticker`/`fundingRate` are the only tri-states left, so assert on a
    // capability the venue does NOT have rather than on a removed order operation.
    const r = await run(
      port({
        describe: async () => ({
          id: 'demoex',
          name: 'DemoEx',
          timeframes: ['1h'],
          precisionMode: 'tick',
          capabilities: exchangeCapabilities({ ohlcv: true, fundingRate: 'none' }),
        }),
      }),
      { connection_id: 'c1' },
    )
    expect(r.content).not.toContain('fundingRate')
    expect(r.content).toContain('ohlcv')
  })

  it('reports an emulated capability, marked as emulated', async () => {
    const r = await run(port(), { connection_id: 'c1' })
    expect(r.content).toContain('fundingRate (emulated)')
  })

  it('explains how to READ precision without asserting a rounding law', async () => {
    const r = await run(port(), { connection_id: 'c1' })
    expect(r.content).toContain('TICK SIZE')
    // The old note said "a precision of 1 means it steps by 1" — false on Hyperliquid, which
    // reports `price: 1` and quotes 63982.5. Never teach the agent a step law we do not own.
    expect(r.content).not.toContain('steps by 1')
  })

  it('tells the agent the exchange rounds, so it never hand-rounds a price', async () => {
    const r = await run(port(), { connection_id: 'c1', symbol: 'BTC/USDC:USDC' })
    expect(r.content).toContain('rounded through the exchange')
  })

  it('quotes a symbol with its order precision and minimums', async () => {
    const r = await run(port(), { connection_id: 'c1', symbol: 'BTC/USDC:USDC' })
    expect(r.content).toContain('price precision 1')
    expect(r.content).toContain('amount precision 0.00001')
    expect(r.content).toContain('min amount 0.0001')
    expect(r.content).toContain('min cost 10')
    expect(r.content).toContain('max leverage 40')
  })

  it('warns that an inactive market will reject a new order without an emoji glyph', async () => {
    const r = await run(
      port({
        markets: async () => [
          {
            symbol: 'BTC/USDC:USDC',
            base: 'BTC',
            quote: 'USDC',
            type: 'swap',
            active: false,
            contract: true,
            contractSize: 1,
            linear: true,
            precision: {},
            limits: {},
          },
        ],
      }),
      { connection_id: 'c1', symbol: 'BTC/USDC:USDC' },
    )
    expect(r.content).toContain('Inactive:')
    expect(r.content).toContain('reduce-only')
    expect(r.content).not.toContain('⚠')
  })

  it('an active market carries no inactive warning', async () => {
    const r = await run(port(), { connection_id: 'c1', symbol: 'BTC/USDC:USDC' })
    expect(r.content).not.toContain('Inactive:')
  })

  it('states the unit a min amount is counted in, on a market that counts contracts', async () => {
    // `min amount 0.001` means nothing without its unit: on a `ctVal: 0.01` venue that is 0.00001
    // BTC, and an agent sizing "0.1 BTC" would send a thousandth of it.
    const okx = port({
      markets: async () => [
        {
          symbol: 'BTC/USDT:USDT',
          base: 'BTC',
          quote: 'USDT',
          type: 'swap',
          active: true,
          contract: true,
          contractSize: 0.01,
          precision: {},
          limits: { minAmount: 1 },
        },
      ],
      ticker: async () => ({ symbol: 'BTC/USDT:USDT', last: 64000 }),
      openInterest: async () => ({ amount: 1000 }),
    })
    const r = await run(okx, { connection_id: 'c1', symbol: 'BTC/USDT:USDT' })
    expect(r.content).toContain('Sizes are in CONTRACTS: 1 contract = 0.01 BTC.')
    // ccxt's `openInterestAmount` is the venue's own unit — OKX's `oi` (contracts), not `oiCcy`.
    expect(r.content).toContain('open interest: 1000 cont')
    expect(r.content).not.toContain('1000 BTC')
  })

  it('explains no contract on a market whose contract IS one coin', async () => {
    const r = await run(port({ openInterest: async () => ({ amount: 5 }) }), {
      connection_id: 'c1',
      symbol: 'BTC/USDC:USDC',
    })
    expect(r.content).not.toContain('Sizes are in CONTRACTS')
    expect(r.content).toContain('open interest: 5 BTC')
  })

  it('says so when the venue lists no metadata for the quoted symbol', async () => {
    const r = await run(port({ markets: async () => [] }), {
      connection_id: 'c1',
      symbol: 'BTC/USDC:USDC',
    })
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('no market metadata')
    expect(r.content).toContain('do not guess a size')
  })

  it('does not sink the quote when market metadata cannot be read', async () => {
    const r = await run(
      port({
        markets: async () => {
          throw new Error('roster down')
        },
      }),
      { connection_id: 'c1', symbol: 'BTC/USDC:USDC' },
    )
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('last 65000')
    expect(r.content).toContain('order constraints unavailable')
  })

  // ── A thin ticker (the Hyperliquid reality) ──────────────────────────────

  it('names the volume unit, and reports quote volume when the venue has no base volume', async () => {
    const r = await run(
      port({
        ticker: async () => ({ symbol: 'BTC/USDC:USDC', last: 65000, quoteVolume: 1_700_000_000 }),
      }),
      { connection_id: 'c1', symbol: 'BTC/USDC:USDC' },
    )
    expect(r.content).toContain('quote vol 1700000000')
  })

  it('derives a range from the candles when the ticker reports no 24h high/low, and NAMES the window', async () => {
    const r = await run(
      port({
        ticker: async () => ({ symbol: 'BTC/USDC:USDC', last: 65000 }),
        ohlcv: async () => [
          { time: 1, open: 1, high: 66000, low: 63000, close: 2, volume: 1 },
          { time: 2, open: 2, high: 65500, low: 62000, close: 3, volume: 1 },
        ],
      }),
      { connection_id: 'c1', symbol: 'BTC/USDC:USDC' },
    )
    expect(r.content).toContain('range over the last 2×1h: H 66000 L 62000')
    // A 2-hour window is not a 24-hour window. Never call it one.
    expect(r.content).not.toContain('24h H')
  })

  it('the symbol output leads the candle bars with a window summary', async () => {
    const r = await run(
      port({
        ohlcv: async () => [
          { time: 1, open: 64000, high: 64500, low: 63800, close: 64200, volume: 1 },
          { time: 2, open: 64200, high: 65500, low: 64100, close: 65000, volume: 1 },
        ],
      }),
      { connection_id: 'c1', symbol: 'BTC/USDC:USDC' },
    )
    expect(r.content).toContain('window (2×1h): O 64000')
    expect(r.content).toContain('C 65000')
    // the raw bars still follow
    expect(r.content).toContain('last 2 1h candle(s):')
  })

  it("prefers the venue's own 24h high/low when it reports them", async () => {
    const r = await run(port(), { connection_id: 'c1', symbol: 'BTC/USDC:USDC' })
    expect(r.content).toContain('24h H 66000 L 64000')
    expect(r.content).not.toContain('range over the last')
  })

  it('a candles failure still quotes the market, and says the range is unknown by omitting it', async () => {
    const r = await run(
      port({
        ticker: async () => ({ symbol: 'BTC/USDC:USDC', last: 65000 }),
        ohlcv: async () => {
          throw new Error('ohlcv down')
        },
      }),
      { connection_id: 'c1', symbol: 'BTC/USDC:USDC' },
    )
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('last 65000')
    expect(r.content).toContain('candles unavailable')
    expect(r.content).not.toContain('range over the last')
  })
})

describe('market_data — a market deployed by a third party', () => {
  const builder: MarketDataMarket = {
    symbol: 'XYZ-AAPL/USDC:USDC',
    base: 'XYZ-AAPL',
    quote: 'USDC',
    type: 'swap',
    active: true,
    operator: 'XYZ',
    // The venue reports no contract flag for this builder market, so sizes read in base units
    // (`size-unit.ts` tests `!market.contract`). Stated, rather than left to an absent field.
    contract: false,
    precision: { price: 0.01, amount: 0.01 },
    limits: { minAmount: 0.01, minCost: 10, maxLeverage: 5 },
  }

  it('names the operator on the roster, so two AAPL rows are not one market', async () => {
    const p = port({
      markets: async () => [
        builder,
        { ...builder, symbol: 'AAPL/USDC', base: 'AAPL', type: 'spot', operator: undefined },
      ],
    })
    const out = await run(p, { connection_id: 'c1' })
    expect(out.content).toContain('XYZ-AAPL/USDC:USDC [swap] · deployed by XYZ')
    // The exchange's own market claims no operator.
    expect(out.content).toContain('AAPL/USDC [spot]')
    expect(out.content).not.toContain('AAPL/USDC [spot] · deployed by')
  })

  it('warns in the order constraints that the venue itself does not stand behind it', async () => {
    const p = port({
      markets: async () => [builder],
      ticker: async () => ({ symbol: 'XYZ-AAPL/USDC:USDC', last: 210 }),
    })
    const out = await run(p, { connection_id: 'c1', symbol: 'XYZ-AAPL/USDC:USDC' })
    expect(out.content).toContain('deployed by XYZ, a third party — NOT the exchange itself')
  })

  it("says nothing about an operator for the exchange's own market", async () => {
    const out = await run(port(), { connection_id: 'c1', symbol: 'BTC/USDC:USDC' })
    expect(out.content).not.toContain('deployed by')
  })
})

// The basket quote. Its whole job is to say what the venue said and nothing more: an absent price is
// a stated absence, a change is only shown where the venue reports a real 24h datum, and a volume
// names the unit it is counted in.
describe('quoteRow', () => {
  it('prints last, the 24h change as a percent, and the volume with its unit', () => {
    const row = quoteRow('BTC/USDC:USDC', {
      symbol: 'BTC/USDC:USDC',
      last: 63982.5,
      change: 0.0124,
      quoteVolume: 1200,
    })
    expect(row).toContain('last 63982.5')
    expect(row).toContain('24h +1.24%')
    expect(row).toContain('quote vol 1200 USDC')
  })

  it('prefers base volume, and names its unit from the MARKET', () => {
    const spot = { symbol: 'BTC/USDC', base: 'BTC', contract: false }
    expect(
      quoteRow('BTC/USDC', { symbol: 'BTC/USDC', last: 1, baseVolume: 7, quoteVolume: 9 }, spot),
    ).toContain('vol 7 BTC')
  })

  it('base volume on a contract market is counted in CONTRACTS, not coins', () => {
    // ccxt's `baseVolume` is the venue's own count — OKX's `vol24h`. Reading the base currency off
    // the unified symbol, as this used to, overstates a day's turnover a hundredfold on `ctVal 0.01`.
    const okx = {
      symbol: 'BTC/USDT:USDT',
      base: 'BTC',
      contract: true,
      contractSize: 0.01,
      linear: true,
    }
    const row = quoteRow('BTC/USDT:USDT', { symbol: 'BTC/USDT:USDT', last: 1, baseVolume: 7 }, okx)
    expect(row).toContain('vol 7 cont')
    expect(row).not.toContain('7 BTC')
  })

  it('a market we could not read names NO volume unit rather than the wrong one', () => {
    expect(
      quoteRow('BTC/USDT:USDT', { symbol: 'BTC/USDT:USDT', last: 1, baseVolume: 7 }),
    ).toContain('vol 7')
    expect(
      quoteRow('BTC/USDT:USDT', { symbol: 'BTC/USDT:USDT', last: 1, baseVolume: 7 }),
    ).not.toContain('BTC ')
  })

  it('quote volume still names its unit from the symbol — the QUOTE currency is in it', () => {
    expect(
      quoteRow('BTC/USDC:USDC', { symbol: 'BTC/USDC:USDC', last: 1, quoteVolume: 9 }),
    ).toContain('quote vol 9 USDC')
  })

  it('a thin ticker shows no change rather than one invented from another field', () => {
    expect(quoteRow('BTC/USDC', { symbol: 'BTC/USDC', last: 1 })).not.toContain('24h')
  })

  it('an unpriced symbol says so — never a zero, never a blank that reads as a flat market', () => {
    expect(quoteRow('NOPE/USDC', undefined)).toBe('NOPE/USDC  (not priced in this read)')
    expect(quoteRow('NOPE/USDC', { symbol: 'NOPE/USDC' })).toContain('not priced')
  })

  it('a negative change keeps its sign and a zero change is not dressed as a gain', () => {
    expect(quoteRow('X/USDC', { symbol: 'X/USDC', last: 1, change: -0.05 })).toContain('24h -5.00%')
    expect(quoteRow('X/USDC', { symbol: 'X/USDC', last: 1, change: 0 })).toContain('24h 0.00%')
  })

  it('flags an inactive market in the basket, so a scan never reads it as a live opportunity', () => {
    const dead = { base: 'X', contract: true, contractSize: 1, linear: true, active: false }
    expect(quoteRow('X/USDC:USDC', { symbol: 'X/USDC:USDC', last: 1 }, dead)).toContain('inactive')
    // even when it could not be priced this read, an inactive market says so
    expect(quoteRow('X/USDC:USDC', undefined, dead)).toContain('inactive')
  })

  it('an active (or unknown-active) market carries no inactive tag', () => {
    const live = { base: 'X', contract: true, contractSize: 1, linear: true, active: true }
    expect(quoteRow('X/USDC:USDC', { symbol: 'X/USDC:USDC', last: 1 }, live)).not.toContain(
      'inactive',
    )
    expect(quoteRow('X/USDC:USDC', { symbol: 'X/USDC:USDC', last: 1 })).not.toContain('inactive')
  })
})

// The basket mode reads the same bulk method the market picker uses. Two of its outcomes are easy to
// confuse and must never be: a market with no quote right now, and a venue that cannot quote in bulk.
describe('market_data basket quote', () => {
  const run = (p: MarketDataPort, input: Record<string, unknown>) =>
    createMarketDataTool({ port: p }).execute('t', input as never, undefined)

  it('quotes every symbol the read priced', async () => {
    const p = port({ tickers: async () => [{ symbol: 'BTC/USDC', last: 63982.5, change: 0.01 }] })
    const r = await run(p, { connection_id: 'c1', symbols: ['BTC/USDC'] })
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('last 63982.5')
  })

  it('a basket row names its volume unit from the market, not from the symbol', async () => {
    const p = port({
      tickers: async () => [{ symbol: 'BTC/USDT:USDT', last: 1, baseVolume: 7 }],
      markets: async () => [
        {
          symbol: 'BTC/USDT:USDT',
          base: 'BTC',
          quote: 'USDT',
          type: 'swap',
          active: true,
          contract: true,
          contractSize: 0.01,
          precision: {},
          limits: {},
        },
      ],
    })
    const r = await run(p, { connection_id: 'c1', symbols: ['BTC/USDT:USDT'] })
    expect(r.content).toContain('vol 7 cont')
  })

  it('a basket whose markets could not be read still quotes, naming no volume unit', async () => {
    const p = port({
      tickers: async () => [{ symbol: 'BTC/USDT:USDT', last: 1, baseVolume: 7 }],
      markets: async () => {
        throw new Error('markets down')
      },
    })
    const r = await run(p, { connection_id: 'c1', symbols: ['BTC/USDT:USDT'] })
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('vol 7')
  })

  it('names the symbols it could not price, and says that is not a zero', async () => {
    const p = port({ tickers: async () => [{ symbol: 'BTC/USDC', last: 1 }] })
    const r = await run(p, { connection_id: 'c1', symbols: ['BTC/USDC', 'NOPE/USDC'] })
    expect(r.content).toContain('NOPE/USDC')
    expect(r.content).toContain('does NOT mean the price is zero')
    expect(r.isError).toBeFalsy()
  })

  it('a venue that cannot quote in bulk is reported as such, not as markets without prices', async () => {
    const p = port({
      tickers: async () => {
        throw Object.assign(new Error('DemoEx cannot quote several markets in one read.'), {
          code: 'not_supported',
        })
      },
    })
    const r = await run(p, { connection_id: 'c1', symbols: ['BTC/USDC', 'ETH/USDC'] })
    expect(r.isError).toBe(true)
    expect(r.content).toContain('once per symbol')
    // It must NOT read as "these two markets have no price".
    expect(r.content).not.toContain('not priced in this read')
  })

  it('a port with no bulk method says so instead of looping per symbol behind the agent', async () => {
    const p = port({})
    delete (p as { tickers?: unknown }).tickers
    const r = await run(p, { connection_id: 'c1', symbols: ['BTC/USDC'] })
    expect(r.isError).toBe(true)
    expect(r.content).toContain('once per symbol')
  })

  it('symbol and symbols together are refused rather than silently resolved', async () => {
    const r = await run(port({ tickers: async () => [] }), {
      connection_id: 'c1',
      symbol: 'BTC/USDC',
      symbols: ['ETH/USDC'],
    })
    expect(r.isError).toBe(true)
    expect(r.content).toContain('not both')
  })
})

// The exchange report: a listing that FAILED and a venue that lists nothing are different facts, and
// the agent decides what to do next from this text.
describe('market_data exchange report', () => {
  const run = (p: MarketDataPort, input: Record<string, unknown>) =>
    createMarketDataTool({ port: p }).execute('t', input as never, undefined)

  it('names a failed market listing instead of omitting the section', async () => {
    const p = port({
      markets: async () => {
        throw new Error('venue unreachable')
      },
    })
    const r = await run(p, { connection_id: 'c1' })
    expect(r.isError).toBeFalsy() // the capability report still lands
    expect(r.content).toContain('market listing unavailable')
    expect(r.content).toContain('venue unreachable')
    expect(r.content).not.toContain('The venue reported no markets')
  })

  it('a venue that genuinely lists nothing says so', async () => {
    const r = await run(port({ markets: async () => [] }), { connection_id: 'c1' })
    expect(r.content).toContain('The venue reported no markets')
  })

  it('order constraints that could not be read name their cause', async () => {
    const p = port({
      markets: async () => {
        throw new Error('venue unreachable')
      },
    })
    const r = await run(p, { connection_id: 'c1', symbol: 'BTC/USDC' })
    expect(r.content).toContain('order constraints unavailable: venue unreachable')
    expect(r.content).toContain('do not guess a size')
  })
})

describe('candleSummary — the window trend at a glance, before the raw bars', () => {
  const k = (open: number, high: number, low: number, close: number) => ({
    time: 0,
    open,
    high,
    low,
    close,
  })

  it('states open→close with direction and percent, plus window high/low', () => {
    const s = candleSummary([k(100, 110, 95, 105), k(105, 120, 104, 118)], '1h') as string
    expect(s).toContain('O 100')
    expect(s).toContain('C 118')
    expect(s).toContain('+18.00%')
    expect(s).toContain('\u25b2') // rose
    expect(s).toContain('H 120') // window high across both bars
    expect(s).toContain('L 95') // window low
    expect(s).toContain('2\u00d71h')
  })

  it('marks a falling window and a negative percent', () => {
    const s = candleSummary([k(100, 101, 90, 92)], '1h') as string
    expect(s).toContain('\u25bc')
    expect(s).toContain('-8.00%')
  })

  it('an empty window has no summary', () => {
    expect(candleSummary([], '1h')).toBeNull()
  })

  it('a zero first-open omits the percent rather than dividing by zero', () => {
    const s = candleSummary([k(0, 5, 0, 3)], '1h') as string
    expect(s).not.toContain('%')
    expect(s).toContain('C 3')
  })
})

describe('trendLine — the MA20/MA50 crossover read for the agent', () => {
  const bar = (close: number) => ({ time: 0, open: close, high: close, low: close, close })
  // 60 closes: a clean uptrend so MA20 (recent) sits above MA50 (older) → bullish.
  const rising = Array.from({ length: 60 }, (_, i) => bar(i + 1))

  it('states both averages and a bullish bias when the fast MA leads the slow', () => {
    const s = trendLine(rising, 60) as string
    expect(s).toContain('MA20')
    expect(s).toContain('MA50')
    expect(s).toContain('bullish')
    expect(s).toContain('MA20 > MA50')
    // last price 60 is above the trailing MA20 (mean of closes 41..60 = 50.5) by (60-50.5)/50.5 = 18.81%
    expect(s).toContain('price above MA20 by 18.81%')
  })

  it('a price hugging the fast MA reports a small stretch, not just a direction', () => {
    const flat = Array.from({ length: 60 }, () => bar(100))
    const s = trendLine(flat, 101) as string // MA20 = 100, price 101 → above by 1.00%
    expect(s).toContain('price above MA20 by 1.00%')
  })

  it('marks a bearish cross on a falling window', () => {
    const falling = Array.from({ length: 60 }, (_, i) => bar(60 - i))
    const s = trendLine(falling, 1) as string
    expect(s).toContain('bearish')
    expect(s).toContain('MA20 < MA50')
    expect(s).toContain('price below MA20')
  })

  it('the default 30-candle window is too short for MA50 — it says so and asserts NO bias', () => {
    const short = Array.from({ length: 30 }, (_, i) => bar(i + 1))
    const s = trendLine(short, 30) as string
    expect(s).toContain('MA20')
    expect(s).toContain('MA50 needs ≥50 candles')
    expect(s).not.toContain('bullish')
    expect(s).not.toContain('bearish')
  })

  it('a window too short for even MA20 has no trend line at all', () => {
    expect(trendLine([bar(10), bar(11)], 11)).toBeNull()
  })
})

describe('market_data indicators — server-side values over the fetched candles', () => {
  const risingCandles = Array.from({ length: 30 }, (_, i) => ({
    time: 1_700_000_000 + i * 3600,
    open: 64_000 + i * 10,
    high: 64_020 + i * 10,
    low: 63_990 + i * 10,
    close: 64_010 + i * 10,
    volume: 5,
  }))

  it('computes the requested indicators from the same window it prints', async () => {
    const r = await run(port({ ohlcv: async () => risingCandles }), {
      connection_id: 'c1',
      symbol: 'BTC/USDC:USDC',
      indicators: ['sma:3', 'rsi:14'],
    })
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('indicators (computed over the 30×1h candles')
    // Trailing SMA(3) of the last closes: 64280, 64290, 64300 → 64290 (1dp for large values).
    expect(r.content).toContain('SMA 3 (sma:3) = 64290.0')
    // A strictly rising series reads RSI 100 by construction.
    expect(r.content).toContain('RSI 14 (rsi:14) = 100')
  })

  it('an unmet lookback and an unknown spec are reported honestly', async () => {
    const r = await run(port({ ohlcv: async () => risingCandles }), {
      connection_id: 'c1',
      symbol: 'BTC/USDC:USDC',
      indicators: ['ema:200', 'bogus'],
    })
    expect(r.content).toContain('insufficient bars')
    expect(r.content).toContain('unknown indicator spec(s): "bogus"')
  })

  it('failed candles mean no indicator claims at all', async () => {
    const r = await run(
      port({
        ohlcv: async () => {
          throw new Error('candles down')
        },
      }),
      { connection_id: 'c1', symbol: 'BTC/USDC:USDC', indicators: ['rsi:14'] },
    )
    expect(r.content).toContain('candles unavailable')
    expect(r.content).toContain('indicators not computed')
    expect(r.content).not.toContain('RSI 14 (rsi:14) =')
  })
})
