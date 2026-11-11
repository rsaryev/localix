// The development launcher's preflights: refuse before anything is spawned when the database
// already has a runtime or a development port is taken, so a conflict reads as one clear message
// instead of a half-started workspace. Called by `scripts/dev-servers.mjs` (`runDevServers`).
import net from 'node:net'

import {
  isRuntimeEndpointLive,
  readRuntimeEndpoint,
  resolveRuntimeIdentity,
} from '../apps/api/src/lib/runtime-endpoint'
import { devUiPort } from './lib/ports.mjs'

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
export async function assertFrontendPortAvailable(port = devUiPort()) {
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
