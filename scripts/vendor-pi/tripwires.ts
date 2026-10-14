/**
 * Run the delta guards after a merge, and prove each one RAN.
 *
 * A guard that executes nothing cannot fail. The repo-root `bunfig.toml` ignores `vendor/**`, so
 * `bun test vendor/pi/…` from the root matched nothing and exited 0 — the 509ee2b sync reported
 * success on a merge that had dropped `modelTools` and the OAuth pages. So a vendored guard runs
 * from its own package directory under the runner that package declares (vitest), a repo guard
 * under `bun test`, and a run whose output shows no passing test is a failure.
 */
import { join, relative } from 'node:path'

import { TRIPWIRE_TIMEOUT_MS, VENDOR_DIR } from './config'
import { run } from './run'

export interface Tripwire {
  path: string
  delta: string
}

export interface TripwireResult {
  tripwire: Tripwire
  ok: boolean
  output: string
}

const VENDORED = new RegExp(`^${VENDOR_DIR}/packages/[^/]+/`)

export async function runTripwire(root: string, tripwire: Tripwire): Promise<TripwireResult> {
  const vendored = VENDORED.exec(tripwire.path)
  const result = vendored
    ? await run(['bunx', 'vitest', '--run', relative(vendored[0], tripwire.path)], {
        cwd: join(root, vendored[0]),
        timeoutMs: TRIPWIRE_TIMEOUT_MS,
      })
    : await run(['bun', 'test', tripwire.path], { cwd: root, timeoutMs: TRIPWIRE_TIMEOUT_MS })
  // oxlint-disable-next-line no-control-regex -- colour codes are what the runners emit
  const output = `${result.stdout}\n${result.stderr}`.replace(/\x1b\[[0-9;]*m/g, '').trim()
  const ran = vendored ? /Tests\s+\d+ passed/.test(output) : /\b[1-9]\d* pass\b/.test(output)
  return {
    tripwire,
    ok: result.ok && ran,
    output: ran ? output : `${output}\n\n(the guard ran no test)`,
  }
}

/** Every guard, in parallel: they are independent, and a sync waits on the slowest one anyway. */
export function runTripwires(
  root: string,
  tripwires: readonly Tripwire[],
): Promise<TripwireResult[]> {
  return Promise.all(tripwires.map((tripwire) => runTripwire(root, tripwire)))
}
