/**
 * RUN SCOPE — the part of run assembly that a parent and its children share.
 *
 * THE PROBLEM. Every run rebuilds its world from scratch in `prepareRunContext`:
 * `loadEnabledPlugins` (a filesystem scan plus `register()` for each enabled plugin —
 * the loader's own comment calls it "the ordinary per-run load"), `discoverFilesystemSkills`
 * (a walk of the project and home skill dirs)
 * plus dynamic import), and `discoverContextFiles`. One session did that 1267 times, once
 * per run in `agent_runs`.
 *
 * The waste is not that a run reloads — it is that PARENT AND CHILD reload the same thing.
 * A spawned child inherits its parent's userId, its projectId, and its cwd (children
 * deliberately share the parent's directory), so its
 * plugin/skill/provider surface is byte-identical to the parent's. The existing frozen
 * snapshot next door (`session-snapshot.ts`) does not help: it caches the volatile PROMPT
 * STRINGS, it is consulted only for `sessionKind === 'chat'`, and it is consulted AFTER
 * these loads have already run.
 *
 * THE SHAPE. An execution-scoped view of the world — built once for a turn or sub-agent
 * loop and handed down, carrying that run's tool/prompt/resource registries. This is that
 * idea narrowed to the
 * expensive half: cache the DISCOVERY by scope, let every run derive its own cheap overlay
 * (disabledTools, role tools, turn/time budgets) on top.
 *
 * WHY THIS KEY. `userId` and `projectId` decide which plugins are enabled and which
 * settings apply; `cwd` decides which filesystem skills and context files are found. Two
 * runs agreeing on all three see the same surface — which is exactly the parent/child
 * relationship. `capabilityRevision` is the invalidation half: enabling a plugin, editing
 * an MCP server or changing an agent provider bumps it, so a toggle is visible to the very
 * next run without anyone remembering to clear anything. It is process-wide and
 * over-invalidates by design (see capabilities/revision.ts) — re-running discovery is
 * cheap, serving a stale enabled set is the bug.
 *
 * NOT CACHED HERE, deliberately: anything role- or turn-shaped. A role's tool allowlist, a
 * child's `maxTurns`, the frozen prompt strings — all of
 * those differ between a parent and its child even in one scope, and all of them are
 * cheap. Only the I/O is shared.
 */
import { createSessionSnapshotCache } from './session-snapshot'
import { capabilityRevision } from '../../capabilities/revision'
import type { DiscoveredSkill } from '../../agent-core/skill-discovery'
import type { discoverContextFiles } from '../../agent-core/context-files'
import type { LoadedPlugins } from '../../plugins/loader'
import type { LoadedMiniApps } from '../../mini-apps/loader-contract'

/**
 * What one scope's discovery pass produces, in the order `prepareRunContext` destructures
 * it. A tuple rather than a named object because the call site is a `Promise.all` whose
 * shape IS the contract — naming the fields here would create a second place to keep in
 * step with it for no reader benefit.
 */
export type ScopeDiscovery = [
  fileSkills: DiscoveredSkill[],
  plugins: LoadedPlugins,
  miniApps: LoadedMiniApps,
  contextFiles: Awaited<ReturnType<typeof discoverContextFiles>>,
]

/** The inputs that decide what a scope can see. */
export interface RunScopeKey {
  userId: string
  /** '' = no project, matching the plugin catalog's own convention. */
  projectId: string
  cwd: string
  /**
   * The agent whose rules decide which plugins are loaded.
   *
   * Part of the key because it is part of the ANSWER. Rules used to compose a chain, and the
   * outer two layers of it were keyed by (user, project) alone — so discovery could resolve
   * against those and be shared by every role in the scope. With the agent's list as the
   * whole policy, sharing across roles would hand one role's loaded plugins to another.
   */
  agentId: string
}

/**
 * A cache of scope-level discovery results.
 *
 * Built on the same LRU primitive as the frozen prompt snapshot instead of a second
 * hand-rolled map — it already has the recency handling and the bounded size, and reusing
 * it keeps one eviction policy in the runtime. The `boundaryMarker` slot carries the
 * capability revision: that parameter exists so an entry can be rejected on a fact the key
 * itself does not encode, which is precisely this.
 */
export function createRunScopeCache<T>(maxEntries = 32) {
  const cache = createSessionSnapshotCache<T>({ maxEntries })
  return {
    /**
     * Return the cached value for this scope, or compute and store it.
     *
     * `load` is invoked at most once per (scope, revision) — but NOTE the deliberate
     * absence of in-flight deduplication: two runs starting concurrently in one scope may
     * both load. Adding a promise map would make the first caller's failure the second
     * caller's failure too, and discovery is failure-isolated per plugin precisely so one
     * bad plugin cannot take down an unrelated run. Paying a duplicate scan in that narrow
     * window is the cheaper trade.
     */
    async resolve(key: RunScopeKey, load: () => Promise<T>): Promise<T> {
      const revision = String(capabilityRevision())
      const scope = JSON.stringify([key.userId, key.projectId, key.cwd, key.agentId])
      const cached = cache.get(scope, revision)
      if (cached !== undefined) return cached
      const value = await load()
      cache.set(scope, revision, value)
      return value
    },
    /** Drop one scope's entry — for a mutation whose effect the revision does not cover. */
    invalidate(key: RunScopeKey): void {
      cache.invalidate(JSON.stringify([key.userId, key.projectId, key.cwd, key.agentId]))
    },
    size: () => cache.size(),
  }
}

export type RunScopeCache<T> = ReturnType<typeof createRunScopeCache<T>>
