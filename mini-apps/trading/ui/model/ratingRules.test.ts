import { describe, expect, test } from 'bun:test'
import {
  adxVote,
  aoVote,
  bullBearVote,
  cciVote,
  ichimokuVote,
  macdVote,
  maVote,
  momentumVote,
  rsiVote,
  stochRsiVote,
  stochVote,
  ultimateVote,
  williamsVote,
} from './ratingRules'

/**
 * Each rule pinned to the published methodology by literal numbers — no candle tape, no
 * indicator math, so a case says exactly what it claims. Every rule gets: the buy case, the
 * sell case, the NEAR-MISS that must stay neutral (this is where the rating's quality lives),
 * and the missing-input abstention.
 *
 * The near-miss cases are the regression tests for the six rules that were previously looser
 * than their source: Stochastic and Stochastic RSI ignored %D, ADX had no cross term, AO had no
 * saucer term, Bull/Bear Power read the combined figure, Ichimoku read price-vs-base-line only,
 * and Ultimate Oscillator was inverted.
 */

describe('rsiVote', () => {
  test('oversold and turning up is a buy; still falling is not', () => {
    expect(rsiVote(25, 22)).toBe('buy')
    expect(rsiVote(25, 28)).toBe('neutral')
  })
  test('overbought and rolling over is a sell; still rising is not', () => {
    expect(rsiVote(75, 78)).toBe('sell')
    expect(rsiVote(75, 72)).toBe('neutral')
  })
  test('mid-range abstains from a call, a missing input abstains entirely', () => {
    expect(rsiVote(50, 45)).toBe('neutral')
    expect(rsiVote(null, 45)).toBeNull()
    expect(rsiVote(50, null)).toBeNull()
  })
})

describe('stochVote', () => {
  test('both lines oversold with %K crossing up is a buy', () => {
    expect(stochVote(15, 12)).toBe('buy')
  })
  test('%K oversold while %D is mid-range is NOT a buy', () => {
    // The regression: the old rule ignored %D and rated this 'buy'.
    expect(stochVote(15, 45)).toBe('neutral')
  })
  test('both lines overbought with %K crossing down is a sell; %D mid-range is not', () => {
    expect(stochVote(85, 88)).toBe('sell')
    expect(stochVote(85, 55)).toBe('neutral')
  })
  test('extremes without the cross stay neutral', () => {
    expect(stochVote(12, 15)).toBe('neutral') // both oversold, %K still below %D
    expect(stochVote(88, 85)).toBe('neutral') // both overbought, %K still above %D
  })
  test('stochRsiVote is the same rule', () => {
    expect(stochRsiVote(15, 12)).toBe('buy')
    expect(stochRsiVote(15, 45)).toBe('neutral')
    expect(stochRsiVote(null, 12)).toBeNull()
  })
})

describe('cciVote', () => {
  test('beyond ±100 with the turn confirmed', () => {
    expect(cciVote(-150, -180)).toBe('buy')
    expect(cciVote(150, 180)).toBe('sell')
    expect(cciVote(-150, -120)).toBe('neutral') // still falling
    expect(cciVote(0, -20)).toBe('neutral')
  })
})

describe('adxVote', () => {
  test('a fresh +DI cross above −DI under a trending ADX is a buy', () => {
    expect(adxVote(25, 30, 20, 18, 22)).toBe('buy')
  })
  test('an ALREADY-crossed DI pair is not a fresh signal', () => {
    // The regression: the old rule voted 'buy' for the entire life of the trend.
    expect(adxVote(25, 30, 20, 28, 22)).toBe('neutral')
  })
  test('the mirror sell, and the same already-crossed abstention', () => {
    expect(adxVote(25, 20, 30, 22, 18)).toBe('sell')
    expect(adxVote(25, 20, 30, 22, 28)).toBe('neutral')
  })
  test('a weak trend (ADX ≤ 20) never votes, however the DI pair crossed', () => {
    expect(adxVote(20, 30, 20, 18, 22)).toBe('neutral')
    expect(adxVote(5, 30, 20, 18, 22)).toBe('neutral')
  })
  test('a missing DI history abstains', () => {
    expect(adxVote(25, 30, 20, null, 22)).toBeNull()
  })
})

describe('aoVote', () => {
  test('the zero-line cross votes in the direction of the cross', () => {
    expect(aoVote(0.5, -0.2, -0.4)).toBe('buy')
    expect(aoVote(-0.5, 0.2, 0.4)).toBe('sell')
  })
  test('a saucer above zero is a buy: the middle bar must be the dip', () => {
    expect(aoVote(3, 1, 2)).toBe('buy') // 2 → 1 → 3
    // The regression: any up-tick above zero used to vote 'buy'. A rising staircase is not a
    // saucer — the middle bar has to be BELOW its neighbour.
    expect(aoVote(3, 2, 1)).toBe('neutral')
  })
  test('a saucer below zero is a sell, and its rising mirror is not', () => {
    expect(aoVote(-3, -1, -2)).toBe('sell')
    expect(aoVote(-3, -2, -1)).toBe('neutral')
  })
  test('with only two bars of history the cross still votes, the saucer cannot', () => {
    expect(aoVote(0.5, -0.2, null)).toBe('buy')
    expect(aoVote(3, 1, null)).toBe('neutral')
    expect(aoVote(null, 1, 2)).toBeNull()
  })
})

describe('momentumVote', () => {
  test('slope decides, and flat is neutral rather than a sell', () => {
    expect(momentumVote(5, 3)).toBe('buy')
    expect(momentumVote(3, 5)).toBe('sell')
    expect(momentumVote(4, 4)).toBe('neutral') // the regression: this used to be 'sell'
  })
})

describe('macdVote', () => {
  test('line against signal, equality neutral', () => {
    expect(macdVote(1.2, 0.8)).toBe('buy')
    expect(macdVote(0.8, 1.2)).toBe('sell')
    expect(macdVote(1, 1)).toBe('neutral')
  })
})

describe('williamsVote', () => {
  test('below −80 turning up buys; above −20 turning down sells', () => {
    expect(williamsVote(-85, -90)).toBe('buy')
    expect(williamsVote(-15, -10)).toBe('sell')
    expect(williamsVote(-85, -82)).toBe('neutral')
    expect(williamsVote(-50, -60)).toBe('neutral')
  })
})

describe('bullBearVote', () => {
  test("Elder's buy: rising trend, bear power negative but recovering", () => {
    expect(bullBearVote(true, 2, 1.5, -1, -2)).toBe('buy')
  })
  test('a rising trend with bear power already positive is not the setup', () => {
    // The regression: the old rule read the COMBINED figure's sign and slope, so a strong bar
    // in any regime voted. Elder's rule wants the pullback still showing.
    expect(bullBearVote(true, 2, 1.5, 1, 0.5)).toBe('neutral')
  })
  test('a rising trend with bear power still deepening is not the setup either', () => {
    expect(bullBearVote(true, 2, 1.5, -2, -1)).toBe('neutral')
  })
  test("Elder's sell mirrors it on bull power under a falling trend", () => {
    expect(bullBearVote(false, 1, 2, -1, -2)).toBe('sell')
    expect(bullBearVote(false, -1, -0.5, -1, -2)).toBe('neutral') // bull power already negative
    expect(bullBearVote(false, 2, 1, -1, -2)).toBe('neutral') // bull power positive but STRENGTHENING
  })
  test('an unknown trend direction abstains', () => {
    expect(bullBearVote(null, 1, 2, -1, -2)).toBeNull()
    expect(bullBearVote(true, null, 2, -1, -2)).toBeNull()
  })
})

describe('ultimateVote', () => {
  test('rated as momentum: above 70 buys, below 30 sells', () => {
    // The regression: this was implemented as mean reversion (inverted) before.
    expect(ultimateVote(75)).toBe('buy')
    expect(ultimateVote(25)).toBe('sell')
    expect(ultimateVote(50)).toBe('neutral')
    expect(ultimateVote(70)).toBe('neutral')
    expect(ultimateVote(30)).toBe('neutral')
    expect(ultimateVote(null)).toBeNull()
  })
})

describe('ichimokuVote', () => {
  // price > conversion > base > spanA > spanB — the full bullish stack.
  test('the whole stack aligned is a buy', () => {
    expect(ichimokuVote(120, 115, 110, 105, 100)).toBe('buy')
  })
  test('price above the base line alone is NOT a buy', () => {
    // The regression: the old rule was price-vs-base-line with a dead band, so this rated 'buy'
    // even against a bearish cloud.
    expect(ichimokuVote(120, 90, 110, 105, 130)).toBe('neutral')
  })
  test('one broken condition drops the whole vote to neutral', () => {
    expect(ichimokuVote(120, 115, 110, 105, 108)).toBe('neutral') // cloud not bullish
    expect(ichimokuVote(120, 115, 100, 105, 90)).toBe('neutral') // base below span A
    expect(ichimokuVote(120, 105, 110, 100, 90)).toBe('neutral') // conversion below base
    expect(ichimokuVote(112, 115, 110, 105, 100)).toBe('neutral') // price below conversion
  })
  test('the bearish mirror sells, and a missing cloud abstains', () => {
    expect(ichimokuVote(80, 85, 90, 95, 100)).toBe('sell')
    expect(ichimokuVote(80, 85, 90, null, 100)).toBeNull()
  })
})

describe('maVote', () => {
  test('price against the average, equality neutral, missing value abstains', () => {
    expect(maVote(105, 100)).toBe('buy')
    expect(maVote(95, 100)).toBe('sell')
    expect(maVote(100, 100)).toBe('neutral')
    expect(maVote(100, null)).toBeNull()
  })
})
