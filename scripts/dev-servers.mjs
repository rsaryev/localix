import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import { resolve } from 'node:path'

import {
  discoverRuntimeEndpoint,
  isRuntimeEndpointLive,
  readRuntimeEndpoint,
  resolveRuntimeIdentity,
} from '../apps/api/src/lib/runtime-endpoint'
import { repoRoot } from './lib/paths.mjs'
import { devApiPort, devUiPort } from './lib/ports.mjs'

const repo = repoRoot()

/** A persistent development database, separate from the installed app's database. */
export function resolveDevDatabaseFile(env = process.env, root = repo) {
  return env.LOCALIX_DB_FILE?.trim() || resolve(root, '.data', 'dev', 'localix.db')
}

export const exitCode = (code, signal) =>
  code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)

function processIsAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * A full dev launch owns the API for its database. Reusing another runtime is
 * not valid here because Vite's proxy is fixed to the requested development
 * port. Detect the conflict before spawning either half of the app so the user
 * never lands in a frontend-only workspace.
 */
export async function assertDevelopmentRuntimeAvailable() {
  const identity = await resolveRuntimeIdentity()
  const descriptor = await readRuntimeEndpoint(identity.endpointFile)
  if (!descriptor || !processIsAlive(descriptor.pid)) return

  const responsive = await isRuntimeEndpointLive(descriptor)
  throw new Error(
    `Cannot start Localix development: database ${identity.databaseFile} is already owned by ` +
      `pid ${descriptor.pid} at ${descriptor.baseUrl} (${responsive ? 'responding' : 'alive but not responding'}). ` +
      `Quit the other Localix app/runtime, then run bun run dev again.`,
  )
}

/** The port `apps/ui`'s dev script passes to Vite. One constant so the check and the log agree. */
export const FRONTEND_DEV_PORT = devUiPort()

/**
 * The exact page origins the dev API must accept from the Vite UI, as `LOCALIX_UI_ORIGINS`.
 *
 * The API no longer trusts "any localhost port" (that let the agent's preview servers and a cloned
 * repository's dev server drive it), so the launcher that picks the UI port is the one that names
 * it. Both spellings: Tauri's dev window loads `localhost`, a browser tab may use `127.0.0.1`.
 */
export function devUiOrigins(port = FRONTEND_DEV_PORT) {
  return [`http://localhost:${port}`, `http://127.0.0.1:${port}`].join(',')
}

/**
 * BOTH loopback addresses, and that is the whole point.
 *
 * Measured: with a listener on `[::1]:P`, binding `127.0.0.1`, `::` or no host at all all report
 * the port FREE. Only binding `::1` sees it. Vite resolves `localhost` and on macOS lands on `::1`
 * first, so a one-address probe is a guard that cannot detect the conflict it exists for.
 */
const LOOPBACKS = ['127.0.0.1', '::1']

const bindOutcome = (host, port) =>
  new Promise((resolveOutcome) => {
    const probe = net.createServer()
    probe.once('error', (error) => resolveOutcome(error.code ?? 'ERROR'))
    probe.listen({ host, port }, () => probe.close(() => resolveOutcome('free')))
  })

/**
 * Which loopback address is already serving `port`, or null when it is startable.
 *
 * Anything other than EADDRINUSE counts as free: a host without IPv6 answers EADDRNOTAVAIL or
 * EAFNOSUPPORT for `::1`, and refusing to launch over that would be worse than the conflict.
 */
export async function busyLoopbackAddress(port, hosts = LOOPBACKS) {
  for (const host of hosts) {
    if ((await bindOutcome(host, port)) === 'EADDRINUSE') return host
  }
  return null
}

/**
 * Refuse before spawning when the frontend port is taken.
 *
 * `assertDevelopmentRuntimeAvailable` promises to "detect the conflict before spawning either half
 * of the app" but only ever checked the API's database owner. A stale Vite from an earlier session
 * therefore passed preflight, failed with EADDRINUSE seconds later, and took the whole Turbo group
 * down with it — API and Tauri included — which reads as "the dev servers crashed, restart
 * everything" rather than as one leftover process.
 */
export async function assertFrontendPortAvailable(port = FRONTEND_DEV_PORT) {
  await assertPortAvailable('frontend', port)
}

/**
 * Refuse before spawning when the API port is taken.
 *
 * The frontend half got this guard and the API half did not, which left the asymmetry the
 * frontend guard exists to prevent: a foreign listener on the API port passed preflight,
 * failed with a raw EADDRINUSE after the (slow) dependency build, and took the whole Turbo
 * group down with it. `assertDevelopmentRuntimeAvailable` does not cover it — that one
 * checks who owns the DATABASE, which says nothing about who holds the port.
 */
export async function assertApiPortAvailable(port) {
  await assertPortAvailable('API', port)
}

async function assertPortAvailable(label, port) {
  const host = await busyLoopbackAddress(port)
  if (!host) return
  throw new Error(
    `Cannot start Localix development: the ${label} port ${port} is already in use on ${host}. ` +
      `A dev server from an earlier session is probably still running — stop it ` +
      `(\`lsof -nP -iTCP:${port} -sTCP:LISTEN\`, then kill that pid) and run bun run dev again.`,
  )
}

/**
 * Observe a child from the moment it is spawned. One durable promise closes the
 * readiness→steady-state listener gap and turns spawn errors into normal state
 * instead of an unhandled EventEmitter error.
 */
export function observeChildProcess(child, label) {
  let outcome
  let settle
  const exited = new Promise((resolveExit) => {
    settle = resolveExit
  })
  const finish = (next) => {
    if (outcome) return
    outcome = next
    settle(next)
  }
  child.once('error', (error) => finish({ code: null, signal: null, error, label }))
  child.once('exit', (code, signal) => finish({ code, signal, error: null, label }))
  return { exited, outcome: () => outcome }
}

/** Above the workspace's persistent dev tasks, with room for more packages. */
const WORKSPACE_DEV_CONCURRENCY = 64

export function resolveDevTurboCommands(workspace) {
  const apiFilter = '--filter=@localixai/api'
  const frontendFilters = workspace
    ? ['--filter=!@localixai/api']
    : ['--filter=@localixai/ui', '--filter=@localixai/agent', '--filter=@localixai/engine...']

  return {
    prepare: ['x', 'turbo', 'dev:prepare', '--output-logs=new-only', apiFilter, ...frontendFilters],
    api: ['x', 'turbo', 'dev', '--only', apiFilter],
    // Every workspace package's persistent `dev` runs at once; Turbo refuses a run whose persistent
    // tasks reach its default concurrency of 10, which the workspace passed as plugins were added.
    frontend: [
      'x',
      'turbo',
      'dev',
      '--only',
      ...(workspace ? [`--concurrency=${WORKSPACE_DEV_CONCURRENCY}`] : []),
      ...frontendFilters,
    ],
  }
}

/**
 * What is actually wrong when the API never answers, in the message itself.
 *
 * The old timeout said only `Timed out waiting for Localix API at <url>`, and the failure mode that
 * really happens is invisible from that: a previous API process still ALIVE while serving nothing (a
 * `bun --watch` whose reload deadlocked on its own lease) leaves a runtime descriptor behind, so the
 * new one cannot take ownership. Naming the descriptor, holder pid and state turns that into a
 * one-look diagnosis. The frontend now starts independently and keeps rendering this failure.
 */
async function describeRuntimeState() {
  try {
    const identity = await resolveRuntimeIdentity()
    const descriptor = await readRuntimeEndpoint(identity.endpointFile)
    if (!descriptor) return `No runtime descriptor at ${identity.endpointFile}.`
    let alive = false
    try {
      process.kill(descriptor.pid, 0)
      alive = true
    } catch {}
    return (
      `Runtime descriptor ${identity.endpointFile} claims ${descriptor.baseUrl} (pid ` +
      `${descriptor.pid}, ${alive ? 'ALIVE but not answering' : 'no longer running'}).` +
      (alive
        ? ' Stop that process, or delete the descriptor and its .api-owner sibling, then retry.'
        : '')
    )
  } catch (error) {
    return `Runtime state could not be inspected (${String(error)}).`
  }
}

export async function waitForHealth(preferredBaseUrl, apiObserver, timeoutMs = 45_000) {
  const startedAt = Date.now()
  let discoveredBaseUrl
  let lastDiscoveryAt = Number.NEGATIVE_INFINITY
  while (Date.now() - startedAt < timeoutMs) {
    const exited = apiObserver.outcome()
    if (exited) {
      if (exited.error) throw exited.error
      throw new Error(
        `Localix API exited before readiness (code=${exited.code}, signal=${exited.signal ?? 'none'}).`,
      )
    }
    const now = Date.now()
    if (now - lastDiscoveryAt >= 500) {
      lastDiscoveryAt = now
      discoveredBaseUrl = (await discoverRuntimeEndpoint().catch(() => null))?.baseUrl
    }
    const candidates = new Set([preferredBaseUrl, discoveredBaseUrl].filter(Boolean))
    for (const baseUrl of candidates) {
      try {
        const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(800) })
        if (response.ok) return baseUrl
      } catch {}
    }
    await Bun.sleep(100)
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for Localix API at ${preferredBaseUrl}. ` +
      `${await describeRuntimeState()} The frontend was started independently; this timeout only ` +
      `describes backend readiness.`,
  )
}

/**
 * Bring `node_modules` up to the checked-in lockfile before anything builds.
 *
 * The defect: a pull that adds a dependency moves `bun.lock` but not `node_modules`, and nothing
 * said so. A bundled plugin importing the new package failed to bundle, dev staging skipped it,
 * and the plugin simply was not in the list — with one console line among hundreds as the only
 * trace. `--frozen-lockfile` installs exactly what the lockfile pins and never rewrites it; when
 * nothing is missing it is a no-op of ~0.1s. A failure (a lockfile that no longer matches its
 * package.json, no network) is reported and development continues on what is installed.
 * Success is silent: bun reports "1 package installed" even when nothing was missing, so its
 * count says nothing about whether this run changed anything.
 */
export function ensureDependenciesInstalled({ run = spawnSync, log = console.log } = {}) {
  const result = run('bun', ['install', '--frozen-lockfile'], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (result.error || result.status !== 0) {
    log(
      `[dev] dependencies may be out of date — \`bun install --frozen-lockfile\` failed; run ` +
        `\`bun install\` yourself:\n${result.error ? String(result.error) : output}`,
    )
    return false
  }
  return true
}

/** One owner for the complete development process tree: API watch + Vite/Turbo. */
export async function runDevServers(args = process.argv.slice(2)) {
  if (args.includes('--isolated')) {
    process.env.LOCALIX_DB_FILE = resolveDevDatabaseFile()
    console.log(`[dev] database: ${process.env.LOCALIX_DB_FILE} (separate from the installed app)`)
  }
  const workspace = args.includes('--workspace')
  const commands = resolveDevTurboCommands(workspace)
  const host = process.env.LOCALIX_DEV_HOST?.trim() || '127.0.0.1'
  const port = devApiPort()
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error('LOCALIX_DEV_API_PORT must be a valid TCP port.')
  }
  await assertDevelopmentRuntimeAvailable()
  await assertFrontendPortAvailable()
  await assertApiPortAvailable(port)
  ensureDependenciesInstalled()
  const preferredBaseUrl = `http://${host}:${port}`
  const children = new Set()
  let stopping = false
  const stop = (signal = 'SIGTERM') => {
    if (stopping) return
    stopping = true
    for (const child of children) child.kill(signal)
  }
  const signalHandlers = new Map()
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => stop(signal)
    signalHandlers.set(signal, handler)
    process.once(signal, handler)
  }

  try {
    // Two concurrent `turbo dev` graphs both expand `dev.dependsOn: ["^build"]`. Their identical
    // build tasks can then race while deleting and rewriting the same dist/ trees. Prepare the
    // combined graph once, then start only the selected persistent tasks below.
    const prepare = spawn('bun', commands.prepare, {
      cwd: repo,
      stdio: 'inherit',
    })
    children.add(prepare)
    prepare.once('exit', () => children.delete(prepare))
    const prepareResult = await observeChildProcess(prepare, 'development dependencies').exited
    if (prepareResult.error) throw prepareResult.error
    if (prepareResult.code !== 0 || prepareResult.signal) {
      return exitCode(prepareResult.code, prepareResult.signal)
    }

    // The API imports runtime entrypoints from compiled workspace packages (for example,
    // @localixai/plugin-sdk/backend). The preparation pass above seeds those outputs on a fresh
    // checkout; --only prevents this independent API supervisor from rebuilding them again.
    const api = spawn('bun', commands.api, {
      cwd: repo,
      env: {
        ...process.env,
        HOST: host,
        PORT: String(port),
        NODE_ENV: 'development',
        LOCALIX_RUNTIME_WATCH: '1',
        LOCALIX_UI_ORIGINS: devUiOrigins(),
      },
      stdio: 'inherit',
    })
    children.add(api)
    api.once('exit', () => children.delete(api))
    const apiObserver = observeChildProcess(api, 'Localix API')

    console.log(
      `[dev] starting frontend at http://localhost:${FRONTEND_DEV_PORT}; API booting independently`,
    )
    const frontend = spawn('bun', commands.frontend, {
      cwd: repo,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        VITE_API_BASE_URL: preferredBaseUrl,
        VITE_WS_BASE_URL: preferredBaseUrl,
      },
      stdio: 'inherit',
    })
    children.add(frontend)
    frontend.once('exit', () => children.delete(frontend))
    const frontendObserver = observeChildProcess(frontend, 'frontend')

    void waitForHealth(preferredBaseUrl, apiObserver).then(
      (baseUrl) => console.log(`[dev] API ready at ${baseUrl}`),
      (error) => console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`),
    )

    // Backend failure must not tear down Vite or prevent Tauri from opening the
    // webview. The UI owns the supervisor lifetime and retries the API lazily.
    const result = await frontendObserver.exited
    stop(result.signal ?? 'SIGTERM')
    if (result.error) throw result.error
    return exitCode(result.code, result.signal)
  } catch (error) {
    stop()
    throw error
  } finally {
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler)
    }
  }
}

if (import.meta.main) {
  process.exitCode = await runDevServers()
}
