import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentFolders } from '../catalog/agent-file'
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
 * Keeps agent bindings current while the app runs. It watches every agents folder the catalog
 * read and the managed, user and each known project's `.claude` folder. A burst of events settles,
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
  // Work started without anyone awaiting it; `idle` lets a test wait for it instead of guessing.
  const background = new Set<Promise<unknown>>()
  const track = (work: Promise<unknown>): void => {
    background.add(work)
    void work.then(
      () => background.delete(work),
      () => background.delete(work),
    )
  }

  // The agents folders each scope's last reconcile read (the kit's answer), beside the folders an
  // agents folder may appear in.
  const read = new Map<string, readonly string[]>()
  const claudeDirs = async (): Promise<string[]> => {
    const dirs = new Set<string>()
    for (const scope of ['', ...(await deps.projects())]) {
      const folders = await deps.folders(scope)
      dirs.add(folders.managed)
      dirs.add(folders.user)
      if (folders.project) dirs.add(folders.project)
    }
    return [...dirs]
  }

  const settle = () => {
    cancelSettle?.()
    cancelSettle = deps.after(settleMs, () => track(reconcileAll()))
  }

  const onError = () => {
    // A watcher that failed may have missed events: start over and let every consumer re-read.
    for (const stop of stops.values()) stop()
    stops.clear()
    track(deps.resync())
    track(arm().then(settle))
  }

  async function arm(): Promise<void> {
    if (stopped) return
    const wanted = new Map<string, { dir: string; recursive: boolean }>()
    const agentsDirs = new Set([...read.values()].flat())
    for (const claude of await claudeDirs()) {
      if (!existsSync(claude)) continue
      wanted.set(`${claude}:parent`, { dir: claude, recursive: false })
      agentsDirs.add(join(claude, 'agents'))
    }
    for (const agents of agentsDirs)
      if (existsSync(agents)) wanted.set(`${agents}:agents`, { dir: agents, recursive: true })
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
            if (name === null || name === 'agents') track(arm().then(settle))
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
        const { purgeDueAt, watch } = await deps.reconcile(scope)
        read.set(scope, watch)
        if (purgeDueAt !== null && (due === null || purgeDueAt < due)) due = purgeDueAt
      }
      await arm()
      cancelPurge?.()
      cancelPurge = null
      if (due !== null)
        cancelPurge = deps.after(Math.max(0, due - (deps.now ?? Date.now)()), () => {
          track(reconcileAll())
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
      track(arm().then(reconcileAll))
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
      track(arm().then(settle))
    },
    /** Resolves once the work started by events and timers has finished. */
    async idle(): Promise<void> {
      while (background.size > 0) await Promise.allSettled(background)
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
