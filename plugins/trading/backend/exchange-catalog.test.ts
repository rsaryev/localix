import { describe, expect, test } from 'bun:test'
import { ccxtExchangeCatalog } from './ccxt-capabilities'

/**
 * The connect form asks for exactly the credentials the catalog says a venue requires. When the
 * catalog was a bare `string[]`, `exchanges.find((e) => e.id === …)` never matched, the picker
 * rendered `{value: undefined, label: undefined}` for every row, and `requiredCredentials` fell
 * back to `[]` — so the form showed no exchanges AND asked for no keys.
 *
 * This runs against the REAL ccxt catalog on purpose: the shape is ccxt's, and a fake would have
 * agreed with the broken code.
 */
describe('the exchange catalog names venues and their credentials', () => {
  test('an entry carries a display name and the fields the venue requires', async () => {
    const entries = await ccxtExchangeCatalog()
    expect(entries.length).toBeGreaterThan(50)

    const hl = entries.find((e) => e.id === 'hyperliquid')
    expect(hl?.name).toBe('Hyperliquid')
    // Verified against ccxt: Hyperliquid signs with a wallet, not an API key/secret pair.
    expect(hl?.requiredCredentials.sort()).toEqual(['privateKey', 'walletAddress'])

    const binance = entries.find((e) => e.id === 'binance')
    expect(binance?.name).toBe('Binance')
    expect(binance?.requiredCredentials.sort()).toEqual(['apiKey', 'secret'])
  })

  test('every entry has a non-empty id and name — a blank row is an unselectable row', async () => {
    for (const e of await ccxtExchangeCatalog()) {
      expect(e.id).toBeTruthy()
      expect(e.name).toBeTruthy()
      expect(Array.isArray(e.requiredCredentials)).toBe(true)
    }
  })

  test('entries are sorted by id, and the catalog is memoized', async () => {
    const first = await ccxtExchangeCatalog()
    const second = await ccxtExchangeCatalog()
    // Constructing ~105 ccxt classes costs ~90ms; it must happen once per process.
    expect(second).toBe(first)
    expect(first.map((e) => e.id)).toEqual(first.map((e) => e.id).sort())
  })
})
