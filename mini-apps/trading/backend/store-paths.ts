/**
 * Turning an untrusted key into a filename — for this mini app's three on-disk stores.
 *
 * This file used to SPELL that rule. It no longer does. It once consolidated trading's own
 * three private copies of the regex, and its header said the right thing — "a security
 * primitive is exactly the wrong thing to keep three copies of" — but it was only ever right
 * about the three it could see. There were four more outside it, two of them in front of
 * credential stores (the secrets vault, the MCP OAuth token store). Consolidating within one
 * mini app just made the fourth copy look intentional.
 *
 * So the rule moved up to `@localixai/mini-app-sdk/backend`, which is now its ONE
 * owner — the same seam this mini app's `errors.ts` already crosses for `ext/typed-error`
 * (a workbench backend is an in-process adapter mounted into the API's Hono app; importing
 * host `features/ext/` from it is the settled ruling, and a mini app importing a MINI APP is what
 * that ruling exists to prevent).
 *
 * Re-exported rather than deleted so `store.ts`, `journal.ts` and `market-table-cache.ts`
 * keep one local, mini-app-relative name for it. Read the owner for the contract — in
 * particular that the map is LOSSY and why that is safe here but not forever.
 */
export { safeFileKey } from '@localixai/mini-app-sdk/backend'
