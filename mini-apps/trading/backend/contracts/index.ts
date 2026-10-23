/**
 * Trading workbench contracts — the exchange-AGNOSTIC vocabulary every layer above the
 * driver speaks. Nothing here mentions ccxt (or Hyperliquid): the ccxt-backed impl in
 * `ccxt-backend.ts` normalizes its raw structures into these shapes, exactly as the
 * database workbench's drivers normalize a postgres/mysql result into `DbQueryResult`.
 *
 * Adding an exchange = a new `ExchangeBackend` impl (or, for anything ccxt covers, just
 * a new `exchangeId`) — never a new field here.
 *
 * Split by domain, and the split carries information: `market` is the PUBLIC, read-only
 * surface the mini app actually registers, while `account` is the DORMANT execution
 * vocabulary that no live route reads. Import from `./contracts` as before — this barrel
 * is the single public face.
 */
export * from './connection'
export * from './market'
export * from './account'
export * from './routes'
