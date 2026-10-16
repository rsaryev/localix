/**
 * What a launch actually costs, read off the runtime's own log.
 *
 * The startup audit that produced the shell snapshot and the discovery warm-up was done
 * by hand: grep `localix-api.log`, find the last boot, count requests, spot the paths that
 * appear seven times. That is a measurement anyone should be able to repeat in one
 * command, and — more to the point — repeat AFTER a change, because "startup feels faster"
 * is not a claim anybody can check.
 *
 * Deliberately a reporter, not a gate. The numbers below are the state of the world, not a
 * target that has already been met, and a red gate for a known-red baseline teaches people
 * to ignore gates. Pass `--max-requests` / `--max-repeat` to turn it into a check once a
 * budget is actually held.
 *
 * Usage:
 *   bun apps/api/scripts/startup-budget.ts [--log <path>] [--window-ms 5000]
 *                                          [--max-requests N] [--max-repeat N]
 */

import { readFileSync } from 'node:fs'

export interface BootRequest {
  time: number
  method: string
  path: string
  queryKeys?: string
  durationMs: number
}

export interface RepeatedPath {
  key: string
  count: number
  totalMs: number
}

/**
 * What one plugin load cost, from the loader's own `plugins.loaded` line.
 *
 * Requests alone never showed this: importing and `register()`-ing every enabled plugin
 * happens off the request path entirely, so the most expensive thing a launch does was
 * invisible to a report about launches.
 */
export interface PluginLoad {
  time: number
  plugins: number
  catalogMs: number
  nativeMs: number
  totalMs: number
  slowest: Array<{ name: string; ms: number }>
}

export interface BootAnalysis {
  /** Epoch ms of the `server.started` this window belongs to. */
  startedAt: number
  windowMs: number
  requests: BootRequest[]
  /** Paths asked for more than once, worst first. */
  repeated: RepeatedPath[]
  /** Mutating calls during startup — a launch should be a read. */
  writes: BootRequest[]
  /** Slowest individual calls, worst first. */
  slowest: BootRequest[]
  /** Every plugin load in the window — more than one means the boot loaded them twice. */
  pluginLoads: PluginLoad[]
}

interface LogLine {
  time?: number
  event?: string
  method?: string
  path?: string
  queryKeys?: string
  durationMs?: number
  plugins?: number
  catalogMs?: number
  nativeMs?: number
  totalMs?: number
  slowest?: Array<{ name: string; ms: number }>
}

/**
 * Analyze the LAST boot in the log.
 *
 * The last one on purpose: the log is append-only across many launches, and the question
 * is always "what did the launch I just did cost". Returns null when the log contains no
 * boot at all, which is a real answer (the runtime never started) and not an error.
 */
export function analyzeBoot(lines: readonly string[], windowMs = 5_000): BootAnalysis | null {
  const parsed: LogLine[] = []
  for (const line of lines) {
    if (!line.startsWith('{')) continue
    try {
      parsed.push(JSON.parse(line) as LogLine)
    } catch {
      // A torn last line (the process was killed mid-write) is not a reason to fail.
    }
  }

  let startedAt: number | undefined
  for (const entry of parsed) {
    if (entry.event === 'server.started' && typeof entry.time === 'number') startedAt = entry.time
  }
  if (startedAt === undefined) return null

  const requests: BootRequest[] = []
  for (const entry of parsed) {
    if (entry.event !== 'request.completed') continue
    if (typeof entry.time !== 'number' || typeof entry.path !== 'string') continue
    if (entry.time < startedAt || entry.time > startedAt + windowMs) continue
    requests.push({
      time: entry.time,
      method: entry.method ?? 'GET',
      path: entry.path,
      ...(entry.queryKeys ? { queryKeys: entry.queryKeys } : {}),
      durationMs: entry.durationMs ?? 0,
    })
  }

  const byKey = new Map<string, RepeatedPath>()
  for (const request of requests) {
    // Keyed by path alone, not path+query: `/rpc/tools/gc?sessionId` and
    // `/rpc/tools/gc?projectId,sessionId` are the same answer fetched twice, and keying
    // them apart would hide exactly the duplication this is looking for.
    const existing = byKey.get(request.path)
    if (existing) {
      existing.count += 1
      existing.totalMs += request.durationMs
    } else {
      byKey.set(request.path, { key: request.path, count: 1, totalMs: request.durationMs })
    }
  }

  const pluginLoads: PluginLoad[] = []
  for (const entry of parsed) {
    if (entry.event !== 'plugins.loaded') continue
    if (typeof entry.time !== 'number' || typeof entry.totalMs !== 'number') continue
    if (entry.time < startedAt || entry.time > startedAt + windowMs) continue
    pluginLoads.push({
      time: entry.time,
      plugins: entry.plugins ?? 0,
      catalogMs: entry.catalogMs ?? 0,
      nativeMs: entry.nativeMs ?? 0,
      totalMs: entry.totalMs,
      slowest: entry.slowest ?? [],
    })
  }

  return {
    startedAt,
    windowMs,
    requests,
    repeated: [...byKey.values()]
      .filter((entry) => entry.count > 1)
      .sort((a, b) => b.count - a.count || b.totalMs - a.totalMs),
    writes: requests.filter((request) => request.method !== 'GET'),
    slowest: [...requests].sort((a, b) => b.durationMs - a.durationMs).slice(0, 8),
    pluginLoads,
  }
}

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

if (import.meta.main) {
  const { runtimeLogFile } = await import('../src/index')
  const logFile = arg('log') ?? runtimeLogFile()
  const windowMs = Number(arg('window-ms', '5000'))
  const maxRequests = arg('max-requests')
  const maxRepeat = arg('max-repeat')

  let contents: string
  try {
    contents = readFileSync(logFile, 'utf8')
  } catch (error) {
    console.error(`Cannot read ${logFile}: ${String(error)}`)
    process.exit(2)
  }

  const analysis = analyzeBoot(contents.split('\n'), windowMs)
  if (!analysis) {
    console.error(`No boot found in ${logFile} — has the runtime started since it was rotated?`)
    process.exit(2)
  }

  const seconds = (analysis.windowMs / 1000).toFixed(0)
  console.log(`Boot at ${new Date(analysis.startedAt).toISOString()} — first ${seconds}s`)
  console.log(`  requests: ${analysis.requests.length}`)
  console.log(
    `  writes:   ${analysis.writes.length}${analysis.writes.length ? ' (a launch should be a read)' : ''}`,
  )
  for (const write of analysis.writes) console.log(`    ${write.method} ${write.path}`)
  if (analysis.repeated.length > 0) {
    console.log('  repeated:')
    for (const entry of analysis.repeated) {
      console.log(`    ${String(entry.count).padStart(2)}x ${entry.key} (${entry.totalMs}ms total)`)
    }
  }
  console.log('  slowest:')
  for (const request of analysis.slowest) {
    console.log(`    ${String(request.durationMs).padStart(5)}ms ${request.method} ${request.path}`)
  }

  if (analysis.pluginLoads.length > 0) {
    const totalMs = analysis.pluginLoads.reduce((sum, load) => sum + load.totalMs, 0)
    // More than one load per boot is the finding, not a detail: each one re-imports
    // every enabled plugin and re-runs its `register()`.
    const repeats =
      analysis.pluginLoads.length > 1 ? ` across ${analysis.pluginLoads.length} loads` : ''
    console.log(`  plugins:  ${totalMs}ms${repeats}`)
    for (const load of analysis.pluginLoads) {
      const worst = load.slowest.map((entry) => `${entry.name} ${entry.ms}ms`).join(', ')
      console.log(
        `    ${String(load.totalMs).padStart(5)}ms  ${load.plugins} plugins (catalog ${load.catalogMs}ms, native ${load.nativeMs}ms)${worst ? ` — ${worst}` : ''}`,
      )
    }
  }

  const failures: string[] = []
  if (maxRequests && analysis.requests.length > Number(maxRequests)) {
    failures.push(`${analysis.requests.length} requests exceeds --max-requests ${maxRequests}`)
  }
  if (maxRepeat) {
    for (const entry of analysis.repeated) {
      if (entry.count > Number(maxRepeat)) {
        failures.push(`${entry.key} fetched ${entry.count}x exceeds --max-repeat ${maxRepeat}`)
      }
    }
  }
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  if (failures.length > 0) process.exit(1)
}
