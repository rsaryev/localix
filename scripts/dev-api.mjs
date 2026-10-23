import { readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { kitCacheRoot } from './plugin-kit-cache.mjs'
import { stageDropins, stageMiniAppKitBeside } from './stage-dropins.mjs'
import { watchMiniAppKitInputs, watchPluginsForRestage } from './dev-plugin-watch.mjs'
import { repoRoot } from './lib/paths.mjs'
import { STAGED_APPS_DIR } from './lib/bundled-roots.mjs'

const repo = repoRoot()
const apiDir = join(repo, 'apps', 'api')
const devStageRoot = join(repo, '.turbo', 'dev-plugins', String(process.pid))
const stagedPlugins = join(devStageRoot, STAGED_APPS_DIR)

/**
 * Drop staging trees left by dev runs that are no longer alive.
 *
 * The `finally` at the bottom removes this run's tree, but it never runs on a SIGKILL, a crash,
 * or an OS kill — so the per-PID trees accumulate. Measured on one developer machine before this
 * was added: 12 orphaned trees and 3.1GB under `.turbo`, of which ~1.2GB was 11 copies of
 * one native database library alone.
 *
 * Conservative on purpose: PIDs are reused, so a directory whose number belongs to ANY live
 * process is kept. The failure mode is then leaving a dead tree for the next run to collect,
 * never deleting a tree a running dev server is serving plugins from.
 */
function pruneOrphanedStageTrees() {
  const root = dirname(devStageRoot)
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) continue
    const pid = Number(entry.name)
    if (pid === process.pid) continue
    try {
      process.kill(pid, 0)
      continue
    } catch (error) {
      // EPERM means the pid exists but belongs to another user — still alive, so keep it.
      if (error?.code === 'EPERM') continue
    }
    rmSync(join(root, entry.name), { recursive: true, force: true })
  }
}

pruneOrphanedStageTrees()

// Runtime discovery is intentionally .localix-only. First-party repo plugins are
// authoring sources, so development uses the same self-contained staging boundary
// as packaged builds before managed copies are synchronized into ~/.localix. The plugin kit comes
// first: the UI builds read it, and the API needs it to create and build user plugins.
// Kits staged for identical inputs are reused across launches (`plugin-kit-cache.mjs`).
const kitCache = kitCacheRoot(repo)
stageMiniAppKitBeside({ repoRoot: repo, outPlugins: stagedPlugins, cacheRoot: kitCache })
stageDropins({
  repoRoot: repo,
  outPlugins: stagedPlugins,
  log: (message) => console.log(`[dev-api] ${message}`),
  // Development keeps booting when one plugin is mid-edit. A compile error in any single plugin
  // used to abort staging, which killed the API, which killed `bun run dev` — the whole workspace
  // held hostage by one file. The error is still printed in full; only the blast radius changed.
  // Release staging (prepare-sidecar.mjs) deliberately keeps the default `fatal`.
  onPluginError: 'skip',
})
// Boot staging is a snapshot; a plugin created or whose backend changed while the API runs
// is re-staged on its own, so `/plugin create` and a backend edit no longer need a restart.
const pluginWatcher = watchPluginsForRestage({
  repoRoot: repo,
  outPlugins: stagedPlugins,
  log: (message) => console.log(`[dev-api] ${message}`),
})
// The kit follows its inputs the same way, so the reloading API never reads a kit older than
// its own authoring code.
const kitWatcher = watchMiniAppKitInputs({
  repoRoot: repo,
  outPlugins: stagedPlugins,
  cacheRoot: kitCache,
  log: (message) => console.log(`[dev-api] ${message}`),
})

const spawnApi = () =>
  Bun.spawn(['bun', '--watch', 'src/index.ts'], {
    cwd: apiDir,
    env: {
      ...process.env,
      LOCALIX_BUNDLED_PLUGINS_DIR: stagedPlugins,
    },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })

let child = spawnApi()
let stopping = false
// Set only while the supervisor is deliberately swapping the child, so its exit is not read as the
// API giving up. Settles once the replacement is in `child`.
/** @type {Promise<void> | undefined} */
let restarting
const stop = (signal) => {
  if (stopping) return
  stopping = true
  supervisor?.stop()
  child.kill(signal)
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => stop(signal))
}

/**
 * Bring the API back when a reload leaves it dead.
 *
 * `bun --watch` re-evaluates the module graph in the same process. If that evaluation THROWS —
 * a half-written file caught mid-save, or an import of a module that was just deleted — the
 * previous realm's listener is already gone and the new one never binds. The process stays alive
 * and serves nothing, and the only symptom is `ECONNREFUSED 127.0.0.1:5051` repeating in Vite's
 * proxy log.
 *
 * Fixing the file is usually enough, because saving it triggers another reload. It is NOT enough
 * when the file was DELETED: the watcher has no path left to watch, so restoring it fires nothing
 * and the API stays down until some other watched file happens to change. That is the case that
 * sent people to restart `bun run dev` by hand — which also happens to be exactly what a large
 * refactor does, dozens of times.
 *
 * So: watch the health endpoint, and when it has been unreachable for long enough that a slow
 * reload is ruled out, respawn — on a widening backoff, because the tree can stay broken for as
 * long as it takes to fix and a restart every few seconds would bury the compiler error that says
 * what to fix. A healthy probe resets the backoff.
 *
 * It keeps trying rather than giving up after one attempt: the case this exists for is a file that
 * came BACK, and only a later respawn can notice that.
 */
function superviseApi() {
  const PROBE_MS = 2_000
  // Three consecutive misses, not one: a reload legitimately drops the socket for a moment, and
  // respawning on that would turn every ordinary save into a full restart.
  const MISSES_BEFORE_RESPAWN = 3
  const MIN_BACKOFF_MS = 5_000
  const MAX_BACKOFF_MS = 60_000

  // `<database file>.api-runtime.json`, the same derivation the runtime uses when it publishes the
  // descriptor. Reading it rather than assuming a port is what keeps this correct when `PORT` was
  // taken and the runtime picked another.
  const databaseFile =
    process.env.LOCALIX_DB_FILE || join(process.env.HOME ?? '', '.localix', 'localix.db')
  const endpointFile = `${databaseFile}.api-runtime.json`

  let misses = 0
  let backoffMs = MIN_BACKOFF_MS
  let nextAttemptAt = 0

  const probe = async () => {
    if (stopping || restarting) return
    let baseUrl
    try {
      baseUrl = JSON.parse(await Bun.file(endpointFile).text()).baseUrl
    } catch {
      // The first boot has not published a descriptor yet. Nothing to judge, and nothing that a
      // restart would help with — a boot that never comes up prints its own error.
      return
    }
    if (!baseUrl) return
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(PROBE_MS) })
      if (response.ok) {
        misses = 0
        backoffMs = MIN_BACKOFF_MS
        return
      }
    } catch {
      // fall through to the miss counter
    }
    misses += 1
    if (misses < MISSES_BEFORE_RESPAWN || Date.now() < nextAttemptAt) return
    misses = 0
    // Back off between attempts. The tree can be broken for as long as it takes to fix, and a
    // restart every six seconds would bury the compiler error that says what to fix.
    nextAttemptAt = Date.now() + backoffMs
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS)
    console.log(
      `[dev-api] the API stopped answering at ${baseUrl} — a reload most likely failed to evaluate. Restarting it.`,
    )
    const swap = (async () => {
      const previous = child
      previous.kill('SIGTERM')
      await previous.exited.catch(() => {})
      if (!stopping) child = spawnApi()
    })()
    restarting = swap
    await swap
    restarting = undefined
  }

  const timer = setInterval(() => void probe(), PROBE_MS)
  timer.unref?.()
  return { stop: () => clearInterval(timer) }
}

const supervisor = superviseApi()

/** The exit that ends the dev server — a supervisor respawn is not one. */
async function waitForFinalExit() {
  for (;;) {
    const code = await child.exited
    if (stopping || !restarting) return code
    await restarting
  }
}

try {
  process.exitCode = await waitForFinalExit()
} finally {
  supervisor.stop()
  pluginWatcher.close()
  kitWatcher.close()
  rmSync(devStageRoot, { recursive: true, force: true })
}
