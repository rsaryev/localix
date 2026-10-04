/**
 * THE capability revision — one monotonic counter for the single fact "the set of
 * capabilities visible to this process changed".
 *
 * "Is this plugin enabled" used to be projected independently in ~6 server-side and
 * ~8 client-side places, synchronized only by a payload-less `plugins.changed` poke.
 * A poke carries no way to tell "you are up to date" from "you missed one": a client
 * that dropped the frame stayed stale forever, and a client that received three
 * refetched three times. This counter is the handle that makes both answerable —
 * `GET /rpc/capabilities/snapshot` stamps it into every snapshot and the stream event
 * carries it, so a consumer compares numbers instead of guessing.
 *
 * Process-wide on purpose, and deliberately NOT per-user or per-project: a capability
 * mutation invalidates discovery, the plugin backend host's wiring, and any runtime
 * cache keyed on the enabled set — all of which are process-scoped. A per-scope
 * counter would need every consumer to know which scopes a mutation touched (a global
 * plugin participates in every project), which is exactly the fan-out this replaces.
 * Over-invalidating is cheap here; under-invalidating is the bug.
 *
 * Bump it from the mutation owner, never from a route: the plugin, MCP, and
 * plugin and MCP services already funnel their mutations through an `onChanged` hook,
 * and bootstrap binds that hook to {@link bumpCapabilityRevision}.
 */

/**
 * Where a process's revisions start: its boot time in milliseconds.
 *
 * The counter used to start at 0, and a client outlives the API process it talks to (the
 * desktop shell restarts its sidecar; a browser tab survives a server restart). Such a client
 * still holds revision N from the old process, and it drops any answer whose revision is LOWER
 * than the one it has — the guard against out-of-order replies — so every snapshot of the new
 * process (0, 1, 2 …) was discarded as stale and plugin toggles were silently ignored until the
 * new process had bumped past N. Seeding from the wall clock keeps the number monotonic ACROSS
 * processes with no client change: the old process could only have reached its own boot time
 * plus its bump count, and bumps are rare user-driven mutations, far fewer than the milliseconds
 * the process lived. (A wall clock set back between two boots is the one case it does not
 * cover; such a client converges on its next reload.) Still well inside a double's exact
 * integer range — `Date.now()` is ~2^41.
 */
export function bootCapabilityRevision(nowMs: number = Date.now()): number {
  return Math.max(0, Math.floor(nowMs))
}

/** Starts at this process's boot epoch = "nothing has changed since boot". Only ever increases. */
let revision = bootCapabilityRevision()

/** The current capability revision. Cheap — read it as often as you like. */
export function capabilityRevision(): number {
  return revision
}

/**
 * Record a capability mutation and return the new revision.
 *
 * Callers do NOT coalesce: a bump is a single integer increment, and swallowing one
 * would break the "a consumer at revision N knows it is behind" property that makes
 * a dropped `plugins.changed` frame detectable at all.
 */
export function bumpCapabilityRevision(): number {
  revision += 1
  return revision
}

/**
 * Test seam: forget every bump (and the boot epoch) so a suite can assert absolute revision
 * values from 0, or start at a chosen value.
 */
export function __resetCapabilityRevision(to = 0): void {
  revision = to
}
