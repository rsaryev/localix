/**
 * What each owner (a mini app) currently holds in a process-wide registry, by key.
 *
 * A mini app backend is loaded again on every rebuild and every reconcile, and the new load
 * registers before the old one is unwired. A registry that refuses a second holder of a name
 * ("already registered") would fail the reload and leave the mini app unwired, and a load the host
 * then discards must not take the entry from the wired one. So the entry is opened once per key,
 * every load brings its own closures, the host's verdict (`settle`) picks which of them answer, and
 * an owner that goes away releases everything. Keys are namespaced by the caller per owner, so one
 * owner can never take another's.
 */
type Release = () => unknown

/** What the backend host decided about the loads of one owner in a pass: see `settle`. */
export type SettleOutcome = 'kept' | 'replaced'

export interface OwnedRegistrations {
  /**
   * Claim `key` for the owner with `target`, the closures this load of the backend brings. The
   * registry entry itself is opened ONCE (`open` receives `current`, which it must call at use time
   * and never capture) and stays; each later load only swaps who answers. The newest load answers
   * until `settle` says otherwise, so a rebuilt backend is served without waiting for the host.
   * `opened` settles when the entry is registered; `dispose` removes this load's target and
   * releases the entry with the last one.
   */
  bind<T>(
    owner: string,
    key: string,
    target: T,
    open: (current: () => T) => Release | Promise<Release>,
  ): { dispose: () => void; opened: Promise<void> }
  /**
   * The backend host's verdict after a pass that loaded the owner again: `kept` means the wired
   * backend stays and the fresh loads were discarded, so the target settled before answers again;
   * `replaced` means the newest load is the wired one. Loads the verdict passed over are dropped.
   */
  settle(owner: string, outcome: SettleOutcome): void
  /** Release every claim of the owner. */
  releaseOwner(owner: string): Promise<void>
}

interface Slot {
  targets: unknown[]
  /** The target the backend host last wired; `kept` returns to it. */
  settled?: unknown
  release?: Release
  opened: Promise<void>
}

export function createOwnedRegistrations(): OwnedRegistrations {
  const slots = new Map<string, Map<string, Slot>>()
  const run = async (release: Release) => {
    try {
      await release()
    } catch {
      // A failing release must not block the reload that replaces it.
    }
  }
  const closeSlot = async (slot: Slot) => {
    await slot.opened.catch(() => undefined)
    if (slot.release) await run(slot.release)
  }
  const dropSlot = (owner: string, key: string, slot: Slot) => {
    const bound = slots.get(owner)
    if (bound?.get(key) === slot) bound.delete(key)
    if (bound?.size === 0) slots.delete(owner)
    void closeSlot(slot)
  }
  return {
    bind(owner, key, target, open) {
      let bound = slots.get(owner)
      if (!bound) slots.set(owner, (bound = new Map()))
      let slot = bound.get(key)
      if (slot) slot.targets.push(target)
      else {
        const fresh: Slot = { targets: [target], opened: Promise.resolve() }
        const current = () => fresh.targets[fresh.targets.length - 1] as typeof target
        // A synchronous refusal reaches the caller and leaves nothing behind.
        const released = open(current)
        bound.set(key, fresh)
        slot = fresh
        if (released instanceof Promise) {
          fresh.opened = released.then(
            (release) => void (fresh.release = release),
            (error) => {
              dropSlot(owner, key, fresh)
              throw error
            },
          )
          fresh.opened.catch(() => undefined)
        } else fresh.release = released
      }
      const owned = slot
      return {
        opened: owned.opened,
        dispose() {
          const at = owned.targets.indexOf(target)
          if (at < 0) return
          owned.targets.splice(at, 1)
          if (owned.targets.length === 0) dropSlot(owner, key, owned)
        },
      }
    },
    settle(owner, outcome) {
      for (const slot of slots.get(owner)?.values() ?? []) {
        const back = outcome === 'kept' && slot.targets.includes(slot.settled)
        const live = back ? slot.settled : slot.targets[slot.targets.length - 1]
        slot.settled = live
        slot.targets = [live]
      }
    },
    async releaseOwner(owner) {
      const bound = [...(slots.get(owner)?.values() ?? [])]
      slots.delete(owner)
      for (const slot of bound) await closeSlot(slot)
    },
  }
}
