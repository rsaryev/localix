/**
 * The chart's indicator MATH + the declarative spec shape, so the canvas is a generic engine
 * (create the declared series, feed them `compute()`, tear them down). The parameterized catalog
 * that builds specs from `IndicatorParams` (and the persisted enabled set) lives in
 * `indicatorSpecs.ts`; SMA is `movingAverage` in `candleSeries.ts`.
 *
 * Honesty rule shared by every computation: a point is emitted ONLY once its full lookback window
 * exists. A "20-period" average over the first 3 bars is a different, misleading number, so every
 * line simply starts `period − 1` (or the equivalent) bars in — no warped heads, ever.
 *
 * Colors are fixed accents (not theme tokens): indicator lines must stay legible and mutually
 * distinct on both themes, and they are not candle/volume semantics. The MACD histogram is the one
 * exception in spirit — its up/down tint mirrors the volume convention, at low alpha so it reads as
 * background.
 *
 * ---
 *
 * This file WAS all of it — fifty-odd functions in 1,315 lines, the fourth-largest in the repo.
 * They are now grouped by family in the siblings below, and this stays as the door: fifteen
 * modules import `./indicators`, and none of them should have to know which family an indicator
 * belongs to in order to name it. A barrel earns its keep when it is the module's public identity
 * rather than an extra hop, and "the indicator catalogue" is exactly that.
 */
export type { IndicatorSpec } from './indicator-contracts'

export { alma, dema, dpo, ema, hma, lsma, momentum, trix, vwma } from './indicator-averages'

export {
  MACD_HIST_UP,
  SUPERTREND_DOWN,
  SUPERTREND_UP,
  adx,
  aroon,
  coppock,
  ichimoku,
  kst,
  macd,
  supertrend,
} from './indicator-trend'

export {
  ao,
  bullBearPower,
  cci,
  chop,
  cmo,
  elderRay,
  fisher,
  rsi,
  stoch,
  stochRsi,
  ultimateOscillator,
  williamsR,
} from './indicator-oscillators'

export {
  atr,
  bbPercent,
  bbWidth,
  bollinger,
  donchian,
  envelopes,
  historicalVol,
  keltner,
  pivotSeries,
  vwap,
  vwapBands,
} from './indicator-bands'

export { accumDist, cmf, easeOfMovement, forceIndex, klinger, obv } from './indicator-volume'
