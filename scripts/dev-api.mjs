// The development API: runs `apps/api/src/index.ts` and restarts it, as a fresh process, when its
// source changes. Started by `apps/api`'s `dev` script, which `scripts/dev-servers.mjs` runs
// (`bun run dev`, `dev:web`, `dev:workspace`).
//
// Why not `bun --watch`, which this used to be:
//  - It watched every file of the module graph, so writes nobody meant as an API edit restarted
//    it: a `tsc --watch` re-emit or Turbo cache restore of `packages/*/dist`, a test rebuilding
//    `dist`, an edit to the linked plugin kit in another checkout. That was "it restarts by itself".
//  - It reloads by re-executing the same process, which keeps the previous image's children (PTY
//    watchdogs, language servers) running unowned, and a file it saw deleted is no longer watched,
//    so restoring it never brought the API back; a health-probe supervisor covered that by
//    killing whatever stopped answering, a busy API included.
// Here the API reads workspace packages from source (`lib/workspace-source.mjs`), only source
// directories are watched, a burst of writes restarts once, the old process gets its graceful
// teardown before the new one starts, and an API that exits on its own (a startup error, another
// runtime taking the database over) is left down until the next source change.
import { watch } from 'node:fs'
import { basename, join, relative } from 'node:path'

import { RUNTIME_SHUTDOWN_DEADLINE_MS } from '../apps/api/src/lib/runtime-protocol'
import { repoRoot } from './lib/paths.mjs'
import { SOURCE_CONDITION, workspaceSourceRoots } from './lib/workspace-source.mjs'

/** Long enough to fold a save, a checkout or a formatter run into one restart. */
const RESTART_DELAY_MS = 200
/** The API's own teardown deadline, plus room to exit; past it the process is killed. */
const STOP_DEADLINE_MS = RUNTIME_SHUTDOWN_DEADLINE_MS + 2_000

/** The API's source, its migrations, and the source of every workspace package it imports. */
export function apiWatchRoots(repo) {
  return [
    join(repo, 'apps/api/src'),
    join(repo, 'apps/api/migrations'),
    ...workspaceSourceRoots(repo, 'apps/api'),
  ]
}

const SOURCE_FILE = /\.(?:[cm]?[jt]s|tsx|json)$/u
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/u
const IGNORED_DIRECTORY = new Set(['node_modules', 'dist', '.turbo'])

/** Whether a change to `path` (relative to a watched root) can change what the API runs. */
export function isReloadTrigger(path) {
  if (path.split(/[\\/]/u).some((segment) => IGNORED_DIRECTORY.has(segment))) return false
  const name = basename(path)
  return SOURCE_FILE.test(name) && !TEST_FILE.test(name) && !name.startsWith('.')
}

/**
 * Debounces change notifications into restarts. A change that arrives while a restart runs is kept
 * and starts one more restart once it finishes. Timers are injected so tests need no real time.
 *
 * @param {{
 *   delayMs: number,
 *   restart: (paths: string[]) => Promise<void>,
 *   setTimer?: (run: () => void, ms: number) => unknown,
 *   clearTimer?: (timer: unknown) => void,
 * }} options
 */
export function createRestartScheduler({
  delayMs,
  restart,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let changed = new Set()
  let timer
  let running = false
  const schedule = () => {
    if (timer !== undefined) clearTimer(timer)
    timer = setTimer(() => void fire(), delayMs)
  }
  const fire = async () => {
    timer = undefined
    running = true
    const paths = [...changed]
    changed = new Set()
    try {
      await restart(paths)
    } finally {
      running = false
      if (changed.size > 0) schedule()
    }
  }
  return {
    notify(path) {
      changed.add(path)
      if (!running) schedule()
    },
    cancel() {
      if (timer !== undefined) clearTimer(timer)
      timer = undefined
      changed = new Set()
    },
  }
}

async function main() {
  const repo = repoRoot()
  const log = (message) => console.log(`[dev-api] ${message}`)
  const spawnApi = () => {
    const proc = Bun.spawn([process.execPath, `--conditions=${SOURCE_CONDITION}`, 'src/index.ts'], {
      cwd: join(repo, 'apps/api'),
      env: process.env,
      stdio: ['inherit', 'inherit', 'inherit'],
    })
    void proc.exited.then((code) => {
      if (proc !== child || stopping) return
      child = undefined
      log(`the API exited (code ${code}); it starts again on the next source change`)
    })
    return proc
  }

  let stopping = false
  /** The running API, or undefined while it is down or being replaced. */
  let child = spawnApi()

  const stopChild = async (signal) => {
    const proc = child
    if (!proc) return 0
    child = undefined
    proc.kill(signal)
    const deadline = setTimeout(() => proc.kill('SIGKILL'), STOP_DEADLINE_MS)
    try {
      return await proc.exited
    } finally {
      clearTimeout(deadline)
    }
  }

  const scheduler = createRestartScheduler({
    delayMs: RESTART_DELAY_MS,
    restart: async (paths) => {
      const more = paths.length > 1 ? ` (+${paths.length - 1} more)` : ''
      log(`${relative(repo, paths[0])}${more} changed; restarting the API`)
      await stopChild('SIGTERM')
      if (!stopping) child = spawnApi()
    },
  })

  const watchers = apiWatchRoots(repo).map((root) =>
    watch(root, { recursive: true }, (_event, name) => {
      if (name && isReloadTrigger(String(name))) scheduler.notify(join(root, String(name)))
    }),
  )

  const finished = Promise.withResolvers()
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      if (stopping) return
      stopping = true
      scheduler.cancel()
      for (const watcher of watchers) watcher.close()
      void stopChild(signal).then(finished.resolve, finished.reject)
    })
  }
  process.exitCode = await finished.promise
}

if (import.meta.main) await main()
