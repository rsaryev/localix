/**
 * Pure normalizers: a driver's raw structures → the agnostic contracts. Kept in their own
 * module family (no ccxt import, no network) so the trickiest part of the driver — shape
 * translation — is unit-tested in isolation, exactly like the Docker workbench's `parse.ts`
 * and the Kubernetes workbench's `parse.ts`.
 *
 * Every input is treated as UNTRUSTED: a venue may omit any optional field, return a string
 * where a number is expected, or emit `null`. Nothing here throws; a missing required field
 * makes the whole entry drop out (`null`), and the caller filters.
 *
 * The normalizers live in sibling modules by subject — the scalar coercions in
 * `normalize-scalars.ts`, instrument metadata + contract carry in `normalize-market.ts`, the
 * and the public feeds in `normalize-feeds.ts` —
 * re-exported here so `./normalize` stays the one entry point its importers and tests use.
 */
export { num } from './normalize-scalars'
export {
  normalizeFundingPayment,
  normalizeFundingPayments,
  normalizeFundingRate,
  normalizeMarket,
  normalizeOpenInterest,
} from './normalize-market'
export {
  normalizeCandle,
  normalizeCandles,
  normalizeOrderBook,
  normalizeTicker,
  normalizeTrade,
} from './normalize-feeds'
