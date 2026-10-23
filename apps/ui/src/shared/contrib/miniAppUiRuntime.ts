import type { MiniAppUiHost } from '@localixai/mini-app-sdk/ui'

/**
 * The lifecycle of mini app UI inside a RUNNING workbench: load, replace and unload one
 * mini app while everything else stays mounted.
 *
 * A mini app's UI is a built artifact the API serves (`MiniAppRecord.ui`), not host source. The
 * host converges on the capability snapshot: a mini app whose artifact revision moved is replaced,
 * a mini app that left the enabled set is unloaded, and nothing else is touched. It is the same
 * path in development and in a packaged app — there is no page reload anywhere in it. (Mini app UI
 * used to be compiled into the host and add-only, so a changed mini app could only be shown by
 * reloading the whole app, which the dev server did mid-turn.)
 *
 * The rules, each answering a failure:
 *  - Import first, swap second. A mini app being edited is broken most of the time; a failed import
 *    keeps the running version, and nothing is removed until a replacement is in hand.
 *  - A registration that throws midway is rolled back and the previous module re-registered, so a
 *    bad build costs the mini app its update, never its presence.
 *  - Styles swap with the module: the new sheets are loaded before the old registrations go, and
 *    the old sheets leave after, so a replaced panel never renders unstyled.
 *  - One queue per mini app; the latest wanted revision wins and stale queued work is skipped.
 *  - Failures are per mini app and reported, never thrown: one broken mini app cannot hide the
 *    rest.
 */

type MiniAppUiModule = { registerUi?: (host: MiniAppUiHost) => void }

/** One enabled mini app's artifact, from the snapshot. */
export interface MiniAppUiArtifact {
  name: string
  entry: string
  styles: readonly string[]
  revision: string
}

/** Told which mini app's UI failed to load, so a broken one is diagnosable. */
export type MiniAppUiFailureReporter = (miniAppName: string, error: unknown) => void

export interface MiniAppUiRuntimeDeps {
  /** Import one artifact entry at one revision. */
  importEntry: (artifact: MiniAppUiArtifact) => Promise<unknown>
  /** Attach an artifact's stylesheets; resolves once they applied, with their removal. */
  mountStyles: (artifact: MiniAppUiArtifact) => Promise<() => void>
  /** The ownership-stamping registration façade for one mini app. */
  hostFor: (miniAppName: string) => MiniAppUiHost
  /** Take back everything `miniAppName` registered. */
  remove: (miniAppName: string) => void
  /** Registries changed without a capability publish: every surface re-reads. */
  announce: () => void
  report: MiniAppUiFailureReporter
}

export interface MiniAppUiRuntime {
  /**
   * Converge on exactly these enabled artifacts. `settled` hears each mini app as ITS work ends
   * (registered, failed or unchanged), so one slow artifact does not hold back the others. `ok`
   * says whether the wanted revision is what is registered now: a failed import is not a load,
   * and a caller that counted it as one closed the mini app's tabs as unavailable.
   */
  reconcile(
    artifacts: readonly MiniAppUiArtifact[],
    settled?: (miniAppName: string, ok: boolean) => void,
  ): Promise<void>
  /** Name → revision of every mini app whose UI is registered right now. */
  loaded(): ReadonlyMap<string, string>
}

interface Loaded {
  revision: string
  module: MiniAppUiModule
  unmountStyles: () => void
}

export function createMiniAppUiRuntime(deps: MiniAppUiRuntimeDeps): MiniAppUiRuntime {
  const loaded = new Map<string, Loaded>()
  /** What the latest reconcile wants per mini app: a revision, or null for "not loaded". */
  const wanted = new Map<string, string | null>()
  const queues = new Map<string, Promise<void>>()

  function enqueue(name: string, task: () => Promise<void>): Promise<void> {
    const next = (queues.get(name) ?? Promise.resolve()).then(task, task)
    queues.set(name, next)
    void next.finally(() => {
      if (queues.get(name) === next) queues.delete(name)
    })
    return next
  }

  function register(name: string, module: MiniAppUiModule): void {
    module.registerUi?.(deps.hostFor(name))
  }

  async function install(artifact: MiniAppUiArtifact): Promise<void> {
    let module: MiniAppUiModule
    let unmountStyles: () => void
    try {
      module = (await deps.importEntry(artifact)) as MiniAppUiModule
      unmountStyles = await deps.mountStyles(artifact)
    } catch (error) {
      deps.report(artifact.name, error)
      return
    }
    const previous = loaded.get(artifact.name)
    if (previous) deps.remove(artifact.name)
    try {
      register(artifact.name, module)
      loaded.set(artifact.name, { revision: artifact.revision, module, unmountStyles })
      previous?.unmountStyles()
    } catch (error) {
      deps.report(artifact.name, error)
      deps.remove(artifact.name)
      unmountStyles()
      loaded.delete(artifact.name)
      if (previous) {
        try {
          register(artifact.name, previous.module)
          loaded.set(artifact.name, previous)
        } catch {
          // It registered once; if it cannot again, the mini app stays out until the next build.
          previous.unmountStyles()
        }
      }
    }
    if (previous) deps.announce()
  }

  function unload(name: string): void {
    const current = loaded.get(name)
    if (!current) return
    loaded.delete(name)
    deps.remove(name)
    current.unmountStyles()
    deps.announce()
  }

  return {
    async reconcile(artifacts, settled) {
      const next = new Map(artifacts.map((artifact) => [artifact.name, artifact]))
      const names = new Set([...next.keys(), ...loaded.keys(), ...wanted.keys()])
      await Promise.all(
        [...names].map(async (name) => {
          const artifact = next.get(name)
          const revision = artifact?.revision ?? null
          if (wanted.get(name) !== revision || (loaded.get(name)?.revision ?? null) !== revision) {
            wanted.set(name, revision)
            await enqueue(name, async () => {
              // A newer reconcile changed its mind while this waited; its own task will run.
              if (wanted.get(name) !== revision) return
              if (!artifact) return unload(name)
              if (loaded.get(name)?.revision !== revision) await install(artifact)
            })
          }
          settled?.(name, (loaded.get(name)?.revision ?? null) === revision)
        }),
      )
    },
    loaded: () => new Map([...loaded].map(([name, entry]) => [name, entry.revision])),
  }
}
