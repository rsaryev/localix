/**
 * Per-mount ref registry for page snapshots. Every emitted snapshot node gets a
 * fresh stable `eN` ref stored here, so the agent can then `click @e3` /
 * `screenshot @e7`. Refs are reassigned on EVERY snapshot (the registry is
 * cleared each time).
 *
 * SELF-HEALING happens at two levels:
 *  1. WITHIN a snapshot generation — each interactive ref captures a durable CSS
 *     selector at snapshot time. If the element is later detached (a re-render
 *     re-mounts it — e.g. a theme toggle), `get()` RE-RESOLVES it by that selector
 *     instead of failing `not_found`, so a click on a "stale" ref still lands.
 *  2. ACROSS generations (driven by actuate/index.ts) — the registry remembers each
 *     ref's structural identity (role + accessible name + selector) AND retains the
 *     PREVIOUS generation's identities across a `clear()`. When a ref the agent
 *     copied from an earlier snapshot no longer resolves (the page re-rendered and a
 *     fresh snapshot reassigned refs), the actuator re-snapshots and calls
 *     `findByIdentity()` to re-resolve the intended element by that identity, retry
 *     once, and hand back a fresh snapshot in the SAME round-trip.
 *
 * Together these break the snapshot → click → "ref not found, page changed" →
 * snapshot death-loop that made driving a re-rendering app
 * unreliable. Zero external deps.
 */

/** Structural identity of a ref, captured while the element was live (interactive nodes). */
export interface RefIdentity {
  /** Durable CSS selector — the primary re-resolution anchor. */
  selector?: string
  /** Tree role label, e.g. `button`, `link`, `textbox`. */
  role?: string
  /** Accessible name, e.g. the button text / input value/placeholder. */
  name?: string
}

interface RefEntry {
  el: Element
  identity: RefIdentity
}

/** Registry mapping `eN` → element, rebuilt on each snapshot. */
export interface RefRegistry {
  /** Drop all refs (called at the start of every snapshot). The just-cleared
   *  generation is retained as the "previous" one so a stale ref from it can still
   *  be re-resolved structurally (see `identityOf` / `findByIdentity`). */
  clear(): void
  /** Assign + store the next `eN` for `el`; `opts` carries the durable structural
   *  identity used to re-resolve the element after a re-render. Returns the ref. */
  put(el: Element, opts?: RefIdentity): string
  /** Resolve `e3` / `@e3` / `3` → a still-connected element (re-resolving via the
   *  captured selector if it was detached), or null. */
  get(ref: string): Element | null
  /** The structural identity captured for a ref — from the CURRENT generation, or
   *  (fallback) the previous one. Used to re-resolve a ref that `get()` couldn't. */
  identityOf(ref: string): RefIdentity | null
  /** Re-resolve an element by structural identity against the CURRENT generation:
   *  try the captured selector first, then a UNIQUE role+name match among the live
   *  refs. Returns the element, or null when there is no match or it is ambiguous
   *  (never guesses between two equally-matching elements). */
  findByIdentity(identity: RefIdentity): Element | null
  /** No snapshot has run in this document yet (neither generation holds a ref): a ref the
   *  agent names came from a snapshot another renderer of the same page took. */
  isEmpty(): boolean
}

function normalizeKey(raw: string): string {
  return String(raw ?? '')
    .replace(/^@/, '')
    .trim()
}

export function createRefRegistry(): RefRegistry {
  let n = 0
  // Plain Map (not WeakRef — avoids needing the ES2021.WeakRef lib). Cleared on
  // every snapshot; the just-cleared generation is kept in `prev` so a ref the
  // agent copied before the re-snapshot can still be re-resolved by identity.
  let map = new Map<string, RefEntry>()
  let prev = new Map<string, RefEntry>()

  function entryFor(raw: string): RefEntry | undefined {
    const key = normalizeKey(raw)
    if (!key) return undefined
    return map.get(key) ?? map.get(`e${key}`)
  }

  return {
    clear() {
      // Retain the outgoing generation for cross-snapshot re-resolution, then start
      // a fresh one. Only ONE prior generation is kept (bounds memory).
      prev = map
      map = new Map<string, RefEntry>()
      n = 0
    },
    put(el, opts) {
      const ref = `e${++n}`
      map.set(ref, { el, identity: opts ?? {} })
      return ref
    },
    get(raw) {
      const entry = entryFor(raw)
      if (!entry) return null
      if (entry.el.isConnected) return entry.el
      // SELF-HEAL (in-generation): the element was detached (typically a re-render
      // re-mounted it). Re-resolve by the durable selector captured at snapshot time
      // and adopt the fresh node, so the ref keeps working across re-renders.
      const healed = resolveSelector(entry.identity.selector)
      if (healed) {
        entry.el = healed
        return healed
      }
      return null
    },
    isEmpty() {
      return map.size === 0 && prev.size === 0
    },
    identityOf(raw) {
      const key = normalizeKey(raw)
      if (!key) return null
      const cur = map.get(key) ?? map.get(`e${key}`)
      if (cur) return cur.identity
      const old = prev.get(key) ?? prev.get(`e${key}`)
      return old ? old.identity : null
    },
    findByIdentity(identity) {
      // 1) The captured selector may now resolve uniquely on the fresh DOM.
      const bySelector = resolveSelector(identity.selector)
      if (bySelector) return bySelector
      // 2) Structural fallback: a UNIQUE live ref whose role+name match. Require a
      //    non-empty name so we never collapse "every button" into one match.
      if (!identity.name) return null
      let found: Element | null = null
      for (const entry of map.values()) {
        if (!entry.el.isConnected) continue
        if (entry.identity.role !== identity.role || entry.identity.name !== identity.name) continue
        if (found && found !== entry.el) return null // ambiguous — refuse to guess
        found = entry.el
      }
      return found
    },
  }
}

/** Resolve a CSS selector to a single connected element, swallowing bad selectors. */
function resolveSelector(selector: string | undefined): Element | null {
  if (!selector) return null
  try {
    const el = document.querySelector(selector)
    return el?.isConnected ? el : null
  } catch {
    return null
  }
}
