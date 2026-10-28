import { afterAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { makeTempDir } from '@localixai/testing'
import {
  createMarketTableCache,
  marketTableCacheKey,
  type RawMarketTable,
} from './market-table-cache'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

const TMP_ROOT = makeTempDir('localix-market-cache')
afterAll(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true })
})

function freshDir(): string {
  return path.join(TMP_ROOT, randomUUID())
}

/** A market table shaped like ccxt's, carrying the fields whose loss would silently corrupt an
 *  order preview: `precision.price` (a TICK SIZE, not a decimal count) and `limits`. */
function sampleTable(): RawMarketTable {
  return {
    markets: {
      'BTC/USDC:USDC': {
        symbol: 'BTC/USDC:USDC',
        type: 'swap',
        precision: { price: 1, amount: 0.00001 },
        limits: { amount: { min: 0.00001 }, cost: { min: 10 } },
        info: { name: 'BTC', hip3: false },
      },
      'XYZ-SP500/USDC:USDC': {
        symbol: 'XYZ-SP500/USDC:USDC',
        type: 'swap',
        precision: { price: 0.1, amount: 0.01 },
        limits: { amount: { min: 0.01 } },
        info: { name: 'XYZ-SP500', hip3: true },
      },
    },
    currencies: { USDC: { id: 'USDC', code: 'USDC', precision: 6 } },
  }
}

describe('marketTableCacheKey — keyed by venue, not by user/connection', () => {
  it('two connections to the same venue resolve the SAME key', () => {
    expect(marketTableCacheKey({ exchangeId: 'hyperliquid' })).toBe(
      marketTableCacheKey({ exchangeId: 'hyperliquid' }),
    )
  })

  it('sandbox is a different venue → different key', () => {
    expect(marketTableCacheKey({ exchangeId: 'hyperliquid', sandbox: true })).not.toBe(
      marketTableCacheKey({ exchangeId: 'hyperliquid' }),
    )
  })

  it('defaultType is included defensively (a venue may scope loadMarkets by it)', () => {
    expect(marketTableCacheKey({ exchangeId: 'binance', defaultType: 'swap' })).not.toBe(
      marketTableCacheKey({ exchangeId: 'binance' }),
    )
  })
})

describe('createMarketTableCache — round-trip', () => {
  it('write then read returns the table LOSSLESSLY (precision + limits intact)', async () => {
    const cache = createMarketTableCache({ dir: freshDir() })
    const before = Date.now()
    await cache.write('hyperliquid', sampleTable())
    const entry = await cache.read('hyperliquid')

    expect(entry).not.toBeNull()
    expect(entry!.savedAt).toBeGreaterThanOrEqual(before)

    const markets = entry!.table.markets
    // The full roster survives — including the HIP-3 market a "drop the type" shortcut would lose.
    expect(Object.keys(markets).sort()).toEqual(['BTC/USDC:USDC', 'XYZ-SP500/USDC:USDC'])
    const btc = markets['BTC/USDC:USDC'] as {
      precision: { price: number }
      limits: { cost: { min: number } }
    }
    // `precision.price` is a TICK SIZE — a lost/rounded value silently corrupts every order preview.
    expect(btc.precision.price).toBe(1)
    expect(btc.limits.cost.min).toBe(10)
    expect(entry!.table.currencies?.USDC).toMatchObject({ code: 'USDC' })
  })

  it('a second write for the same key overwrites (and re-stamps savedAt)', async () => {
    const cache = createMarketTableCache({ dir: freshDir() })
    await cache.write('hyperliquid', { markets: { 'A/B': { symbol: 'A/B' } } })
    const first = await cache.read('hyperliquid')
    await turns()
    await cache.write('hyperliquid', { markets: { 'C/D': { symbol: 'C/D' } } })
    const second = await cache.read('hyperliquid')

    expect(Object.keys(second!.table.markets)).toEqual(['C/D'])
    expect(second!.savedAt).toBeGreaterThanOrEqual(first!.savedAt)
  })
})

describe('createMarketTableCache — a bad cache is a MISS, never a crash and never empty', () => {
  it('an absent file reads as null', async () => {
    const cache = createMarketTableCache({ dir: freshDir() })
    expect(await cache.read('never-written')).toBeNull()
  })

  it('a corrupt (non-JSON) file reads as null, does not throw', async () => {
    const dir = freshDir()
    const cache = createMarketTableCache({ dir })
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'hyperliquid.json'), '{ this is not json', 'utf8')
    expect(await cache.read('hyperliquid')).toBeNull()
  })

  it('a well-formed file with an EMPTY market map reads as null (never "venue lists nothing")', async () => {
    const dir = freshDir()
    const cache = createMarketTableCache({ dir })
    await mkdir(dir, { recursive: true })
    await writeFile(
      path.join(dir, 'hyperliquid.json'),
      JSON.stringify({ savedAt: Date.now(), table: { markets: {} } }),
      'utf8',
    )
    expect(await cache.read('hyperliquid')).toBeNull()
  })

  it('a file missing savedAt reads as null (partial/renamed shape)', async () => {
    const dir = freshDir()
    const cache = createMarketTableCache({ dir })
    await mkdir(dir, { recursive: true })
    await writeFile(
      path.join(dir, 'hyperliquid.json'),
      JSON.stringify({ table: { markets: { 'A/B': {} } } }),
      'utf8',
    )
    expect(await cache.read('hyperliquid')).toBeNull()
  })

  it('writing an empty table is a NO-OP — it never poisons the cache into asserting no markets', async () => {
    const cache = createMarketTableCache({ dir: freshDir() })
    await cache.write('hyperliquid', { markets: {} })
    expect(await cache.read('hyperliquid')).toBeNull()
  })
})
