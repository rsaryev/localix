import { describe, expect, test } from 'bun:test'
import {
  contractNote,
  notionalOf,
  sizeColumn,
  sizeUnit,
  withSizeUnit,
  type SizeUnitMarket,
} from './size-unit'

const spot: SizeUnitMarket = { base: 'BTC', contract: false }
/** Hyperliquid: a contract market whose contract IS one base unit. */
const hl: SizeUnitMarket = { base: 'BTC', contract: true, contractSize: 1, linear: true }
/** OKX `BTC-USDT-SWAP`: `ctVal` 0.01, so one contract is 0.01 BTC. */
const okx: SizeUnitMarket = { base: 'BTC', contract: true, contractSize: 0.01, linear: true }
/** An inverse contract: one contract is a fixed amount of QUOTE. */
const inverse: SizeUnitMarket = { base: 'BTC', contract: true, contractSize: 100, linear: false }

describe('sizeUnit', () => {
  test('a spot size is an amount of the asset', () => {
    expect(sizeUnit(spot)).toEqual({ label: 'BTC', isBase: true, basePerUnit: 1 })
  })

  test('a contractSize:1 contract market counts in base units too — and says so', () => {
    // Hyperliquid. Labelling this `cont` would be pedantry the trader has to translate.
    expect(sizeUnit(hl)).toEqual({ label: 'BTC', isBase: true, basePerUnit: 1 })
  })

  test('a contract market counts in CONTRACTS', () => {
    expect(sizeUnit(okx)).toEqual({ label: 'cont', isBase: false, basePerUnit: 0.01 })
  })

  test('a contract market the venue never sized is still not base units', () => {
    // We know the amount is not an amount of BTC; we just cannot say how much it is.
    expect(sizeUnit({ base: 'BTC', contract: true })).toEqual({
      label: 'cont',
      isBase: false,
      basePerUnit: undefined,
    })
  })

  test('an unknown market is unknown, not base', () => {
    expect(sizeUnit(null).label).toBe('')
    expect(sizeUnit(null).isBase).toBe(false)
  })
})

describe('contractNote', () => {
  test('nothing to explain when the size IS an amount of the asset', () => {
    expect(contractNote(spot)).toBeNull()
    expect(contractNote(hl)).toBeNull()
  })

  test('states what one contract is', () => {
    expect(contractNote(okx)).toBe('Sizes are in CONTRACTS: 1 contract = 0.01 BTC.')
  })

  test('says the size is unknown rather than assuming 1', () => {
    expect(contractNote({ base: 'BTC', contract: true })).toContain('did not state')
  })
})

describe('withSizeUnit', () => {
  test('labels a number with the venue’s unit', () => {
    expect(withSizeUnit('0.5', spot)).toBe('0.5 BTC')
    expect(withSizeUnit('50', okx)).toBe('50 cont')
  })

  test('an unknown market gets no invented unit', () => {
    expect(withSizeUnit('0.5', null)).toBe('0.5')
  })
})

describe('sizeColumn — the unit named once, in the header', () => {
  test('a column of spot sizes is a column of the asset', () => {
    expect(sizeColumn('Size', spot)).toBe('Size (BTC)')
  })

  test('a contract market names CONTRACTS, not the coin the reader assumes', () => {
    expect(sizeColumn('amount', okx)).toBe('amount (cont)')
  })

  test('a one-base contract keeps the base label — that IS what the number counts', () => {
    expect(sizeColumn('Size', hl)).toBe('Size (BTC)')
  })

  test('an unreadable market names no unit rather than the wrong one', () => {
    expect(sizeColumn('Size', null)).toBe('Size')
    expect(sizeColumn('amount', undefined)).toBe('amount')
  })
})

describe('notionalOf — the ONE definition of what an order is worth', () => {
  test('spot and a contractSize:1 perp are amount × price', () => {
    expect(notionalOf(2, 50, spot)).toBe(100)
    expect(notionalOf(2, 50, hl)).toBe(100)
  })

  test('a LINEAR contract multiplies by the contract size', () => {
    // 100 contracts of 0.01 BTC at 64000 is one BTC — not 6.4 million.
    expect(notionalOf(100, 64_000, okx)).toBe(64_000)
  })

  test('an INVERSE contract is already quote-denominated — the price does not enter', () => {
    expect(notionalOf(3, 64_000, inverse)).toBe(300)
    expect(notionalOf(3, 1, inverse)).toBe(300)
  })

  test('an unsized or unclassified contract market cannot be valued', () => {
    expect(notionalOf(1, 100, { base: 'BTC', contract: true, linear: true })).toBeUndefined()
    expect(notionalOf(1, 100, { base: 'BTC', contract: true, contractSize: 0.01 })).toBeUndefined()
  })

  test('an unknown market is not a spot market', () => {
    expect(notionalOf(1, 100, null)).toBeUndefined()
  })

  test('a non-positive amount or price is unvaluable, never zero', () => {
    expect(notionalOf(0, 100, spot)).toBeUndefined()
    expect(notionalOf(1, 0, spot)).toBeUndefined()
    expect(notionalOf(1, undefined, spot)).toBeUndefined()
    expect(notionalOf(1, Number.NaN, spot)).toBeUndefined()
    // An inverse contract still needs no price — its value does not depend on one.
    expect(notionalOf(1, undefined, inverse)).toBe(100)
  })
})
