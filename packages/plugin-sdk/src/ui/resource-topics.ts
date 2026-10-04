/**
 * THE invalidation protocol: how a plugin says "this data just moved" and everyone who shows it
 * finds out.
 *
 * Every plugin here hit the same wall. A fact is written in one place — a picker in a sidebar, a
 * dialog on a canvas, a tool call the agent made — and READ somewhere that has no idea the write
 * happened: a titlebar glyph, a composer pill, another panel. The writer has no business knowing
 * its readers exist, and the reader has no event to hang off.
 *
 * Five plugins solved it, five times, with the same twenty lines: a module holding a `Set` of
 * listeners, an `announceX`, a `subscribeX`. Two of the five never got wired up at all — Database
 * had the reader and the refresh function and nothing in between, and the API client's picker
 * announced only for the agent's writes, so switching an environment by hand updated the sidebar
 * while the titlebar went on naming the one you had just left. That is what a per-plugin copy of a
 * cross-cutting mechanism costs: not the duplication, the ones that are quietly incomplete.
 *
 * So it lives here once, as three ideas:
 *
 *   - a TOPIC is a named thing that can change, namespaced by whoever owns it. It is
 *     a value both sides import, never a string each side spells, so a typo cannot silently
 *     disconnect a reader from its writer;
 *   - a WRITER invalidates it, and knows nothing else. One line at the end of a mutating call in
 *     the plugin's own client module, where every write already passes;
 *   - a READER subscribes — usually by construction, since {@link createSharedResource} takes a
 *     topic and re-reads itself.
 *
 * Deliberately NOT a message bus. A topic carries no payload and no verb: it says something under
 * this name changed, and every reader goes and looks. A payload would make each writer responsible
 * for what its readers need, which is the coupling this exists to remove, and it would let two
 * readers disagree about what happened.
 *
 * Deliberately NOT a poller either — see {@link SharedResource}. The two moments that move a list
 * are the plugin doing the thing and the surface being opened, and both are announceable.
 *
 * ── KEYS ────────────────────────────────────────────────────────────────────────
 * Some data is app-global (a machine's saved connections) and some is per-session (a chat's
 * boards). Invalidating with a key says only that scope moved; invalidating without one says the
 * whole topic did. A reader watching one key hears both, and ignores another key's news.
 */

export interface ResourceTopic {
  /** `<plugin>:<thing>` — namespaced like every other plugin-chosen identity. */
  readonly name: string
  /**
   * Announce a change. `key` narrows it to one session or scope; omit it when the whole topic
   * moved, which is the right call for app-global data and for a write that could touch anything.
   */
  invalidate(key?: string): void
  /** Listen outside React. The listener receives the key that moved, or `null` for all of them. */
  subscribe(listener: (key: string | null) => void): () => void
}

const topics = new Map<string, ResourceTopic>()

/**
 * Declare a topic, or return the one already declared under this name.
 *
 * Idempotent on purpose: two modules naming the same topic must share one listener set, or a
 * writer and a reader that agree on the name would still never meet. It also survives a hot
 * reload, where the module holding the handle is re-evaluated while its subscribers are not.
 */
export function resourceTopic(name: string): ResourceTopic {
  const existing = topics.get(name)
  if (existing) return existing

  const listeners = new Set<(key: string | null) => void>()
  const topic: ResourceTopic = {
    name,
    invalidate(key?: string) {
      // A copy, because a listener may unsubscribe (or subscribe) while this runs — a resource
      // that finishes loading during its own invalidation is the ordinary case.
      for (const listener of Array.from(listeners)) listener(key ?? null)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  topics.set(name, topic)
  return topic
}

/**
 * Whether a listener watching `watched` should act on an invalidation of `changed`.
 *
 * Exported because it is the whole semantic of a key, and a reader that is not a
 * {@link SharedResource} has to make the same call.
 */
export function resourceKeyAffected(
  watched: string | null | undefined,
  changed: string | null,
): boolean {
  if (changed === null) return true
  if (watched === null || watched === undefined) return true
  return watched === changed
}

/** Drop every topic's listeners. For teardown and for tests, which must not leak across cases. */
export function resetResourceTopics(): void {
  for (const name of Array.from(topics.keys())) topics.delete(name)
}
