/**
 * Every in-flight write that can change what the next agent run receives, by scope.
 *
 * Lives in `shared/contrib` rather than beside the Settings screens because the
 * capability cache — the one writer of every toggle — has to register with it, and the
 * send path has to wait on it. Two features and one shared store agreeing on a fact
 * means the fact belongs below all three.
 */

const UNKNOWN_SCOPE = Symbol('unknown-capability-scope')
type ScopeKey = string | null | typeof UNKNOWN_SCOPE

const pending = new Map<ScopeKey, Set<Promise<unknown>>>()

function key(projectId: string | null | undefined): ScopeKey {
  return projectId === undefined ? UNKNOWN_SCOPE : projectId
}

function activePromises(projectId: string | null | undefined): Promise<unknown>[] {
  if (projectId === undefined) return [...pending.values()].flatMap((entries) => [...entries])
  return [...(pending.get(key(projectId)) ?? []), ...(pending.get(UNKNOWN_SCOPE) ?? [])]
}

/**
 * Track a capability WRITE through persistence and frontend convergence, so a run
 * started in the same breath cannot overtake it.
 *
 * Switching capabilities is tracked automatically — `toggleCapabilities` wraps every
 * toggle in this, which is the point: the barrier used to be opt-in at each call site,
 * and a switch added later simply forgot it (a skill toggle did exactly that, and a
 * message sent right after it could assemble a run that still carried the skill).
 *
 * What still calls this by hand is what is NOT a toggle: installing, removing,
 * creating, importing, pinning — writes with their own endpoints and their own shapes.
 * They register here for the same reason, but they cannot be funnelled through one
 * function the way switches can.
 */
export function trackCapabilityWrite<T>(
  projectId: string | null | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const scope = key(projectId)
  let entries = pending.get(scope)
  if (!entries) {
    entries = new Set()
    pending.set(scope, entries)
  }
  let resolveTracked!: (value: T | PromiseLike<T>) => void
  let rejectTracked!: (reason?: unknown) => void
  const tracked = new Promise<T>((resolve, reject) => {
    resolveTracked = resolve
    rejectTracked = reject
  })
  // Register before invoking application code: even a synchronous callback that
  // immediately starts a run must observe this mutation.
  entries.add(tracked)
  const settle = () => {
    entries!.delete(tracked)
    if (entries!.size === 0 && pending.get(scope) === entries) pending.delete(scope)
  }
  void tracked.then(settle, settle)
  try {
    void Promise.resolve(operation()).then(resolveTracked, rejectTracked)
  } catch (error) {
    rejectTracked(error)
  }
  return tracked
}

/** Allocation-free when no write can change this run's capability surface. */
export function waitForCapabilityWrites(
  projectId: string | null | undefined,
): Promise<void> | null {
  const active = activePromises(projectId)
  if (active.length === 0) return null
  if (active.length === 1) return active[0]!.then(() => undefined)
  return Promise.all(active).then(() => undefined)
}
