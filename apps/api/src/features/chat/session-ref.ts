/**
 * The session-ref formatter as a schema-free LEAF (`@localixai/api/session-ref`).
 * `chat/contracts.ts` (its previous home) constructs the request schemas at module
 * top level, so a browser VALUE-import of it through `client.ts` drags zod into the
 * eagerly-preloaded client chunk — the UI takes this one function from here instead.
 */

/** Human-friendly session reference, e.g. `LOCALIX-42` — the short, token-cheap
 *  handle that is ALSO the session's canonical id (no UUIDs). */
export function sessionRef(seq: number): string {
  return `LOCALIX-${seq}`
}
