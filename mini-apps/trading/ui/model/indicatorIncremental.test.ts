import { describe, expect, test } from 'bun:test'
import type { Candle } from '../../backend/contracts'
import { movingAverage } from './candleSeries'
import { ema } from './indicator-averages'
import { rsi } from './indicator-oscillators'
import {
  emaStepper,
  incrementalLine,
  rsiStepper,
  smaStepper,
  type Stepper,
} from './indicatorIncremental'
import { resolveIndicators } from './indicatorSpecs'

function bar(i: number, close: number): Candle {
  return { time: 1_700_000_000 + i * 60, open: close, high: close + 1, low: close - 1, close }
}

/** Deterministic noisy walk — enough float churn to expose any reordered arithmetic. */
function series(n: number, seed = 7): Candle[] {
  let x = seed
  let price = 100
  const out: Candle[] = []
  for (let i = 0; i < n; i++) {
    x = (x * 1_103_515_245 + 12_345) % 2_147_483_648
    price += (x / 2_147_483_648 - 0.5) * 3.7
    out.push(bar(i, price))
  }
  return out
}

type Full = (candles: Candle[], period: number) => ReturnType<typeof movingAverage>
const cases: [string, (p: number) => Stepper<unknown>, Full][] = [
  ['sma', smaStepper as (p: number) => Stepper<unknown>, movingAverage],
  ['ema', emaStepper as (p: number) => Stepper<unknown>, ema],
  ['rsi', rsiStepper as (p: number) => Stepper<unknown>, rsi],
]

describe('incremental indicators equal a full recompute', () => {
  for (const [name, stepper, full] of cases) {
    for (const period of [1, 2, 14, 50]) {
      test(`${name}(${period}) across ticks, rollovers and resets`, () => {
        const compute = incrementalLine(stepper(period))
        let candles = series(80).slice(0, 3)
        const source = series(200)
        expect(compute(candles)).toEqual(full(candles, period))
        for (let i = 3; i < 200; i++) {
          // Rollover: finalise the last bar (corrected close) and append the next — reusing bars.
          const corrected = { ...candles.at(-1)!, close: candles.at(-1)!.close + 0.25 }
          candles = [...candles.slice(0, -1), corrected, source[i]!]
          expect(compute(candles)).toEqual(full(candles, period))
          // Live ticks on the forming bar.
          for (const delta of [0.1, -0.33, 1.7]) {
            const tick = { ...candles.at(-1)!, close: candles.at(-1)!.close + delta }
            candles = [...candles.slice(0, -1), tick]
            expect(compute(candles)).toEqual(full(candles, period))
          }
        }
        // A deep correction, a prepend and a shrink all fall back to a full pass.
        const corrected = candles.map((c, i) => (i === 10 ? { ...c, close: c.close * 2 } : c))
        expect(compute(corrected)).toEqual(full(corrected, period))
        const prepended = [bar(-1, 90), ...corrected]
        expect(compute(prepended)).toEqual(full(prepended, period))
        expect(compute(prepended.slice(0, 5))).toEqual(full(prepended.slice(0, 5), period))
        expect(compute([])).toEqual([])
      })
    }
  }

  test('the resolved specs route through the incremental path and stay exact', () => {
    const byId = new Map(
      resolveIndicators(new Set(['sma:20', 'ema:20', 'rsi:14'])).map((s) => [s.id, s]),
    )
    let candles = series(120)
    for (let i = 0; i < 30; i++) {
      const tick = { ...candles.at(-1)!, close: candles.at(-1)!.close + (i % 3) - 1 }
      candles =
        i % 5 === 0 ? [...candles, bar(200 + i, tick.close)] : [...candles.slice(0, -1), tick]
      const [smaSpec, emaSpec, rsiSpec] = ['sma:20', 'ema:20', 'rsi:14'].map((id) => byId.get(id))
      expect(smaSpec!.compute(candles).line).toEqual(movingAverage(candles, 20))
      expect(emaSpec!.compute(candles).line).toEqual(ema(candles, 20))
      expect(rsiSpec!.compute(candles).line).toEqual(rsi(candles, 14))
    }
  })
})
