import { join } from 'node:path'

import { repoRoot } from './lib/paths.mjs'

const repo = repoRoot()
const apiDir = join(repo, 'apps', 'api')

// Localix ships no mini app and no mini app kit: the store installs mini apps, and a mini app
// installs the kit it is built against (`docs/extending/mini-apps.md`).
const spawnApi = () =>
  Bun.spawn(['bun', '--watch', 'src/index.ts'], {
    cwd: apiDir,
    env: process.env,
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
}
