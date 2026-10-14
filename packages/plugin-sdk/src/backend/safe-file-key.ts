/**
 * Turning an untrusted key into a filename — once, for every store in the repo.
 *
 * WHY IT LIVES IN THE SDK. Its callers are five host stores AND five plugin stores, and a plugin
 * cannot import `apps/api`: the boundary contract (`plugin-boundary-contract.test.ts`) exists to
 * stop exactly that, and every plugin store was reaching across it by relative path to inject
 * this function into `createUserEntityStore`. A security primitive smuggled over a boundary that
 * a test is meant to enforce is the worst of both worlds — the rule is still single-owner, but
 * nothing about the arrangement says so.
 *
 * Moving it here does NOT republish or copy it: this package is the one both sides already
 * depend on, the host imports it from here like everyone else, and the single-owner contract
 * (`safe-file-key-contract.test.ts`, which still lives in apps/api because it reads the host's
 * `app.ts` precondition) simply names this file as the owner now.
 *
 * This is not formatting. It is the boundary that keeps a crafted key (`../../etc/passwd`,
 * an absolute path, a NUL) from steering a `path.join` out of the store directory it was
 * handed. The input is genuinely untrusted: every `userId` in this app is the raw,
 * unauthenticated `x-user-id` request header (`app.ts` — `c.req.header('x-user-id')`), so
 * whatever a caller sends arrives here verbatim.
 *
 * It was open-coded FOUR times with identical bodies — the secrets vault, the MCP OAuth
 * token store, an extension connection store, and another plugin's own store-paths (which had
 * already consolidated several copies, and whose header rightly said "a security
 * primitive is exactly the wrong thing to keep three copies of" — it just never learned
 * about the four outside it). Four places a hardening fix has to land; three places it can
 * be forgotten; two of them credential stores. `safe-file-key.test.ts` now makes a fifth
 * copy fail the build.
 *
 * ALLOW-LIST, deliberately: every character outside `[A-Za-z0-9_-]` becomes `_`. A deny-list
 * would have to enumerate the ways a path can be escaped, and it would be wrong on the first
 * one it missed. `.` and `/` are not on the list, so `..`, every separator, NUL, and every
 * unicode look-alike separator are already gone. The result is a single path SEGMENT: it can
 * never be empty-of-meaning in a way that escapes, and it can never re-introduce a separator.
 *
 * LOSSY, BY CONSTRUCTION — and that is a RULING, not an oversight. Read this before relying on
 * the key to SEPARATE anything.
 *
 * The map is not injective: `a/b` and `a_b` both become `a_b`. Two distinct keys can therefore
 * land in one file. It stays that way DELIBERATELY, on one precondition:
 *
 *     `userId` is self-asserted — the raw `x-user-id` header, verified by nothing.
 *
 * While that holds, the collision separates nothing, because there is nothing to separate:
 * anyone who can forge `a/b` can simply send `a_b` instead. There is no authentication to
 * collide past. (A non-userId cache caller keys off already-safe
 * venue ids.) Making the key injective TODAY would mean migrating every file already on disk
 * across seven stores — two of them credential stores — to defend a boundary that does not
 * exist; and it would be a GUESS, because the right derivation depends on what an authenticated
 * principal id turns out to look like. If ids arrive as UUIDs or opaque OIDC `sub`s, this
 * function is ALREADY the identity function on them and injectivity is free.
 *
 * The day `userId` becomes AUTHENTICATED, the same collision becomes a cross-user credential
 * leak, and the fix belongs HERE — in the one owner — not in seven stores that have to remember.
 * That day is not left to memory: `safe-file-key-contract.test.ts` reads the precondition out of
 * `app.ts` and FAILS THE BUILD the moment `userId` stops being self-asserted, with the migration
 * checklist in the failure message. You cannot land auth without tripping it. Do not add a caller
 * that depends on this key being unique without changing this function and migrating the files
 * already written under the old names.
 */
export function safeFileKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_')
}
