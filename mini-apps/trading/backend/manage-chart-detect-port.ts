import type { MarketDataCandle } from './market-data-port'
import type { ChartCommandPayload } from './chart-command'
import type { FundingRate, OrderBook } from './contracts'

/** What a detect scan reads: the same service candles `market_data` reads, plus best-effort extras. */
export interface ChartDetectPort {
  /** READ-ONLY service candles; unwired → an honest "detection unavailable". */
  ohlcv?(
    connection: string,
    symbol: string,
    timeframe: string,
    limit: number,
  ): Promise<MarketDataCandle[]>
  /** READ-ONLY, best-effort perp funding; a spot market rejects and the line is omitted. */
  funding?(connectionId: string, symbol: string): Promise<FundingRate | null>
  /** READ-ONLY, best-effort depth snapshot for the spread / book-imbalance read. */
  orderBook?(connectionId: string, symbol: string, limit: number): Promise<OrderBook>
}

/** The UI command channel, when the run has one — detect only uses it for `auto_draw`. */
export interface DetectCommandSink {
  emitCommand?(miniApp: string, channel: string, payload: ChartCommandPayload): void
}
