/**
 * PLUGIN BACKEND HOST — the live composition seam that makes plugin backends hot.
 *
 * Boot used to wire every enabled plugin's `BackendSubsystem` exactly once: routes
 * mounted via a static `app.route()` loop, providers registered in one bootstrap
 * pass. Toggling a plugin therefore needed a process restart. This host owns that
 * wiring as a RECONCILER instead: `reconcile()` recomputes the desired set (via the
 * same failure-isolated `loadPluginBackends` path boot used) and diffs it against
 * what is currently wired, per plugin — enable wires, disable unwires, boot is just
 * the first reconcile. There is exactly ONE wiring code path.
 *
 * Route mounting is the part Hono cannot do live (routes cannot be unmounted), so
 * the static loop is replaced by ONE stable dispatcher middleware reading a mutable
 * mount table per request. Delegating with `wrapper.fetch(c.req.raw)` drops the parent
 * context, so a plugin route cannot read `c.get('userId')` — that used to be called
 * lossless because plugins re-derived the user from the host's env module, which is
 * precisely the boundary crossing `plugin-boundary-contract.test.ts` polices. The resolved
 * scope (user, project, CURRENT cwd) now travels as the mounted app's `c.env` instead.
 *
 * SDK capabilities follow the same wire/unwire lifecycle as every other
 * contribution. They used to be the boot-frozen exception — resolved ONCE into chat deps at
 * bootstrap and never unregistered — which broke hot toggling in both directions: a plugin enabled
 * after boot never lit up, and a plugin DISABLED after boot kept serving core, because `deps` still
 * held the function it had captured. Fixed by making the consumer side resolve LATE (bootstrap
 * passes a resolver, not a value) AND unregistering here; either half alone leaves the other path
 * live.
 *
 * Ordering rules: wire registers providers FIRST and mounts the route LAST (a route
 * never serves before its providers exist); unwire runs `onShutdown()` FIRST (stops
 * the plugin's live streams/sockets), then unregisters, then drops the mount.
 */
import { Hono } from 'hono'
import type { Env, Schema } from 'hono'
import { createDebouncer } from '../../lib/debounce'
import type { BackendSubsystem } from '../ext/subsystem-contrib'
import type { SearchProviderRegistry } from '../agent-core/search/provider'
import type { PluginRouteScope } from '@localixai/plugin-sdk/backend'
import { createPluginUiActionTable } from './backend-host-ui-actions'

import type { PluginBackendHostDeps, PluginBackendHost } from './backend-host-contracts'
import { planPluginBackends } from './backend-host-plan'

export type { PluginBackendHostDeps, PluginBackendHost } from './backend-host-contracts'

const REFRESH_DEBOUNCE_MS = 300

interface WiredBackend {
  backend: BackendSubsystem
  /** The pre-built delegate app for the route mount (absent when no routeMount). */
  wrapper?: Hono
}

export function createPluginBackendHost(deps: PluginBackendHostDeps): PluginBackendHost {
  /** Wired subsystems by OWNING PLUGIN name (a plugin may contribute several). */
  const wired = new Map<string, WiredBackend[]>()
  /**
   * The code revision each wired plugin was wired from. "Already wired" used to mean "wired
   * under this NAME", so a plugin whose backend was rebuilt kept serving the first build it ever
   * wired — a timer plugin rebuilt three times and `/rpc/timer` kept answering 404 from the
   * template's routes. A plugin whose revision moved is unwired and wired again.
   */
  const wiredRevisions = new Map<string, string>()
  /** Exact-scope UI handlers; unlike process-global providers, project overrides coexist. */
  let uiActions = createPluginUiActionTable()
  /** Live mount table the dispatcher reads per request. */
  const mounts = new Map<string, Hono>()
  /** Subsystem ids whose capabilities are currently registered — one register per id, so a
   *  reconcile that reloads an already-wired plugin does not re-register (and re-warn). Cleared
   *  by `unwireBackend`, or a re-enable would be skipped as already-wired. */
  const capabilitiesWired = new Set<string>()
  let searchRegistry: SearchProviderRegistry | undefined
  const refreshDebouncer = createDebouncer(REFRESH_DEBOUNCE_MS)
  // Serializes reconciles so overlapping toggles converge to last-state-wins.
  let lifecycle: Promise<void> = Promise.resolve()
  let stopped = false

  function wireBackend(pluginName: string, backend: BackendSubsystem): WiredBackend {
    deps.subsystemRegistry.register(backend)
    if (!capabilitiesWired.has(backend.id)) {
      capabilitiesWired.add(backend.id)
      deps.capabilityRegistry.register(backend.id, backend.capabilities)
    }
    // WS-frame contributions are UNTRUSTED plugin data: a duplicate subscribe/
    // unsubscribe command is unroutable, so a collision is rejected LOUDLY here
    // instead of crashing the reconcile for every other subsystem.
    for (const frame of backend.wsFrames ?? []) {
      const outcome = deps.wsFrameRegistry.register(frame)
      if (outcome.status === 'rejected') {
        deps.logger?.warn(`ws frame rejected for "${backend.id}"`, {
          reason: outcome.reason,
          command: outcome.command,
        })
      }
    }
    if (backend.resourceProvider) deps.resourceRefsRegistry.register(backend.resourceProvider)
    for (const provider of backend.contextProviders ?? []) {
      const diagnostic = deps.contextProviderRegistry.tryRegister(provider, backend.id)
      if (diagnostic.status === 'rejected') {
        deps.logger?.warn(`context provider rejected for "${backend.id}"`, {
          providerId: diagnostic.providerId,
          reason: diagnostic.reason,
        })
      }
    }
    deps.textInputSurfaceRegistry?.registerAll(
      backend.textInputCompletionSurfaces,
      { plugin: pluginName, source: backend.id },
      deps.logger?.warn,
    )
    if (backend.searchProvider) searchRegistry?.register(backend.searchProvider)

    // Mount LAST — the route never serves before its providers exist. The wrapper
    // re-creates the mount-path prefix so `wrapper.fetch(raw)` sees the full URL.
    let wrapper: Hono | undefined
    if (backend.routeMount) {
      // FIRST-WINS on a duplicate path, out loud — the rule every other contribution in
      // this function already follows (wsFrames + context providers return `rejected`,
      // capabilities warn, `capabilitiesWired` guards). `routeMount.path` is a free
      // string from the plugin ('/rpc/<id>' is a convention, not a constraint), so two
      // plugins CAN claim one path — and plugin-builder tells authors to copy a bundled
      // plugin's structure. Overwriting served the first plugin's route from the
      // SECOND's app, silently, while every id-keyed guard beside it stayed happy.
      const taken = mounts.get(backend.routeMount.path)
      if (taken) {
        deps.logger?.warn(
          `duplicate route mount "${backend.routeMount.path}" for "${pluginName}/${backend.id}" — keeping the first`,
        )
      } else {
        wrapper = new Hono()
        wrapper.route(
          backend.routeMount.path,
          backend.routeMount.app as unknown as Hono<Env, Schema, string>,
        )
        mounts.set(backend.routeMount.path, wrapper)
      }
    }
    deps.logger?.info?.(`plugin backend wired: ${pluginName}/${backend.id}`)
    return { backend, wrapper }
  }

  async function unwireBackend(pluginName: string, entry: WiredBackend): Promise<void> {
    const { backend } = entry
    // Shutdown FIRST: it stops the plugin's live WS streams and child processes,
    // which the registry unregisters below cannot reach (they only block NEW work).
    try {
      await Promise.resolve(backend.onShutdown?.())
    } catch (err) {
      deps.logger?.warn(`plugin backend "${backend.id}" onShutdown threw`, { error: String(err) })
    }
    for (const frame of backend.wsFrames ?? []) {
      // Pass the frame, not its command — this loop walks every frame the subsystem DECLARED,
      // including ones `register` rejected as duplicates, and a name-only removal took the
      // still-enabled winner's stream with it.
      deps.wsFrameRegistry.unregister(frame)
    }
    if (backend.resourceProvider) {
      // Pass the provider, not its scheme — a scheme-only disable evicts whoever holds it.
      deps.resourceRefsRegistry.unregister(backend.resourceProvider)
    }
    // Pass the provider, not its id — an id-only disable evicts whoever holds that id.
    if (backend.searchProvider) searchRegistry?.unregister(backend.searchProvider)
    // Capabilities too: leaving them registered meant a DISABLED plugin's implementation kept
    // serving core (a host fallback called into a plugin the user had turned off). The
    // `capabilitiesWired` entry goes with it, so a re-enable registers again instead of being
    // skipped as already-wired.
    deps.capabilityRegistry.unregister(backend.id)
    capabilitiesWired.delete(backend.id)
    deps.contextProviderRegistry.unregisterBySource(backend.id)
    deps.textInputSurfaceRegistry?.unregisterBySource(backend.id)
    deps.subsystemRegistry.unregister(backend.id)
    // Identity-checked, like `activeRuns.get(id) === abort` in run-teardown: a disable
    // must only ever drop the mount it OWNS. Deleting by path alone tore the route out
    // from under a still-enabled plugin that had won the path first — its subsystem and
    // UI tab stayed, only `/rpc/...` went dead, with nothing said.
    if (entry.wrapper && mounts.get(backend.routeMount!.path) === entry.wrapper) {
      mounts.delete(backend.routeMount!.path)
    }
    deps.logger?.info?.(`plugin backend unwired: ${pluginName}/${backend.id}`)
  }

  async function reconcileNow(): Promise<void> {
    // Fresh load = fresh `register()` runs for every enabled plugin. That is the
    // per-run loader's status quo (register() already runs per turn); for a plugin
    // that is ALREADY wired the fresh duplicate is simply discarded and the wired
    // instance kept, so live streams/services are never churned by an unrelated
    // toggle.
    const desired = await deps.loadBackends()
    // The load is the slow part; a shutdown that landed meanwhile must not get new wiring.
    if (stopped) return
    const { desiredByName, nextUiActions, refused, revisionOf } = planPluginBackends(desired, deps)

    // Deleting the CURRENT key mid-iteration is well-defined for a Map, and the awaits
    // below cannot interleave another writer (reconciles are serialized on `lifecycle`).
    for (const [pluginName, entries] of wired) {
      const stillDesired = desiredByName.has(pluginName)
      if (stillDesired && wiredRevisions.get(pluginName) === revisionOf(pluginName)) continue
      wired.delete(pluginName)
      wiredRevisions.delete(pluginName)
      for (const entry of entries) await unwireBackend(pluginName, entry)
    }
    for (const [pluginName, backends] of desiredByName) {
      if (wired.has(pluginName)) continue
      wired.set(
        pluginName,
        backends.map((backend) => wireBackend(pluginName, backend)),
      )
      wiredRevisions.set(pluginName, revisionOf(pluginName))
    }
    // Publish only after the full desired pass succeeds. A failed refresh keeps
    // the last known-good action table just like it keeps the wired providers.
    uiActions = nextUiActions
    for (const [name, problems] of refused) deps.conditions?.backendProblems(name, problems)
  }

  /** One reconcile, and its outcome as a condition: a failed pass stays visible until one works. */
  async function reconcileReported(): Promise<void> {
    try {
      await reconcileNow()
      if (stopped) return
      deps.conditions?.reconciled()
    } catch (err) {
      deps.conditions?.reconciled(err instanceof Error ? err.message : String(err))
      throw err
    }
  }

  function enqueue(task: () => Promise<void>): Promise<void> {
    if (stopped) return Promise.resolve()
    lifecycle = lifecycle.catch(() => undefined).then(task)
    return lifecycle
  }

  return {
    middleware() {
      return async (c, next) => {
        const path = c.req.path
        for (const [prefix, wrapper] of mounts) {
          if (path === prefix || path.startsWith(`${prefix}/`)) {
            // The raw request loses the parent context, which is why a plugin route cannot read
            // `c.get('userId')`. Hono's second `fetch` argument IS the mounted app's `c.env`, so
            // the resolved scope travels there instead of being re-derived by every plugin from
            // the host's own env module (which is how that boundary got crossed in the first
            // place). Resolution failures degrade to no environment rather than a 500: a plugin
            // route that does not need scope must keep working.
            const userId = c.get('userId') as string | undefined
            let scope: PluginRouteScope | undefined
            if (deps.resolveScope && userId) {
              try {
                scope = await deps.resolveScope({ userId, request: c.req.raw })
              } catch (err) {
                deps.logger?.warn('plugin route scope resolution failed', { error: String(err) })
              }
            }
            return wrapper.fetch(c.req.raw, scope)
          }
        }
        return next()
      }
    },
    refresh() {
      refreshDebouncer.schedule(() => {
        void enqueue(async () => {
          try {
            await reconcileReported()
          } catch (err) {
            deps.logger?.warn('plugin backend reconcile failed', { error: String(err) })
          }
          // Settle AFTER convergence (even a failed one — the UI refetch is cheap
          // and self-correcting), so a listener never observes half-wired routes.
          deps.onSettled?.()
        })
      })
    },
    reconcile: () => enqueue(reconcileReported),
    setSearchRegistry(registry) {
      searchRegistry = registry
      for (const entries of wired.values()) {
        for (const { backend } of entries) {
          if (backend.searchProvider) registry.register(backend.searchProvider)
        }
      }
    },
    // Reads the table at CALL time: a reconcile swaps in a new one rather than mutating it.
    invokeUiAction: (input) => uiActions.invoke(input),
    wired: () => [...wired.keys()],
    async stop() {
      stopped = true
      refreshDebouncer.cancel()
      await lifecycle.catch(() => undefined)
    },
  }
}
