import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentFolders } from '../catalog/scan'
import type { AgentSnapshot } from './bindings'

/** Runs `fn` after `ms` and returns the cancel. Injected so tests own the clock. */
export type After = (ms: number, fn: () => void) => () => void

export type WatchDir = (
  dir: string,
  recursive: boolean,
  onEvent: (name: string | null) => void,
  onError: () => void,
) => () => void

export interface AgentWatcherDeps {
  /** Reconcile one scope ('' = no project); the owner writes what changed with its notices. */
  reconcile(projectId: string): Promise<AgentSnapshot>
  folders(projectId: string): Promise<AgentFolders>
  /** The projects whose `.claude/agents` are read. */
  projects(): Promise<readonly string[]>
  /** Announce `resync`: consumers re-read every agent (start, a watcher error or overflow). */
  resync(): Promise<void>
  watch: WatchDir
  after: After
  now?: () => number
  settleMs?: number
  /** A periodic reconcile, the backstop for a watcher that missed an event. */
  everyMs?: number
}

const SETTLE_MS = 300
const EVERY_MS = 60_000

/**
 * Keeps agent bindings current while the app runs. It watches every folder the catalog reads:
 * the managed and user `.claude/agents` and each known project's chain. A burst of events settles,
 * then every scope reconciles; a definition that vanished is purged once its grace has run, which
 * this schedules. The folder itself may not exist yet, so its parent is watched for `agents`.
 */
export function createAgentWatcher(deps: AgentWatcherDeps) {
  const settleMs = deps.settleMs ?? SETTLE_MS
  const stops = new Map<string, () => void>()
  let cancelSettle: (() => void) | null = null
  let cancelPurge: (() => void) | null = null
  let cancelEvery: (() => void) | null = null
  let running = false
  let again = false
  let stopped = true

  const claudeDirs = async (): Promise<string[]> => {
    const dirs = new Set<string>()
    for (const scope of ['', ...(await deps.projects())]) {
      const folders = await deps.folders(scope)
      dirs.add(folders.managed)
      dirs.add(folders.user)
      for (const dir of folders.project ?? []) dirs.add(dir)
    }
    return [...dirs]
  }

  const settle = () => {
    cancelSettle?.()
    cancelSettle = deps.after(settleMs, () => void reconcileAll())
  }

  const onError = () => {
    // A watcher that failed may have missed events: start over and let every consumer re-read.
    for (const stop of stops.values()) stop()
    stops.clear()
    void deps.resync()
    void arm().then(settle)
  }

  async function arm(): Promise<void> {
    if (stopped) return
    const wanted = new Map<string, { dir: string; recursive: boolean }>()
    for (const claude of await claudeDirs()) {
      if (!existsSync(claude)) continue
      wanted.set(`${claude}:parent`, { dir: claude, recursive: false })
      const agents = join(claude, 'agents')
      if (existsSync(agents)) wanted.set(`${claude}:agents`, { dir: agents, recursive: true })
    }
    for (const [key, stop] of stops)
      if (!wanted.has(key)) {
        stop()
        stops.delete(key)
      }
    for (const [key, { dir, recursive }] of wanted) {
      if (stops.has(key)) continue
      stops.set(
        key,
        deps.watch(
          dir,
          recursive,
          (name) => {
            if (recursive) return settle()
            // Only `agents` itself matters in the parent: it may appear or go.
            if (name === null || name === 'agents') void arm().then(settle)
          },
          onError,
        ),
      )
    }
  }

  async function reconcileAll(): Promise<void> {
    if (stopped) return
    if (running) {
      again = true
      return
    }
    running = true
    try {
      let due: number | null = null
      for (const scope of ['', ...(await deps.projects())]) {
        const { purgeDueAt } = await deps.reconcile(scope)
        if (purgeDueAt !== null && (due === null || purgeDueAt < due)) due = purgeDueAt
      }
      cancelPurge?.()
      cancelPurge = null
      if (due !== null)
        cancelPurge = deps.after(Math.max(0, due - (deps.now ?? Date.now)()), () => {
          void reconcileAll()
        })
    } finally {
      running = false
      if (again) {
        again = false
        settle()
      }
    }
  }

  const tick = () => {
    cancelEvery = deps.after(deps.everyMs ?? EVERY_MS, () => {
      void arm().then(reconcileAll)
      tick()
    })
  }

  return {
    /** Watch, reconcile every scope now and announce `resync`. */
    async start(): Promise<void> {
      stopped = false
      await arm()
      await deps.resync()
      await reconcileAll()
      tick()
    },
    /** A project or a plugin changed: watch what is now read and reconcile. */
    refresh(): void {
      void arm().then(settle)
    },
    reconcileAll,
    stop(): void {
      stopped = true
      for (const stop of stops.values()) stop()
      stops.clear()
      cancelSettle?.()
      cancelPurge?.()
      cancelEvery?.()
    },
  }
}

export type AgentWatcher = ReturnType<typeof createAgentWatcher>
