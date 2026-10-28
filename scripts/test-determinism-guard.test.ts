import { describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { countsOf, measure, type Counts, type Rule } from './test-determinism'

/**
 * Ratchet: a unit test is deterministic, so it never waits on the real clock or a fixed port.
 *
 * A test that sleeps (`setTimeout(r, 30)`, `Bun.sleep`) or listens on a fixed port passes alone and
 * fails when the whole suite runs in parallel on a busy machine: the wait it guessed is too short,
 * or the port is taken. `docs/internals/testing.md` already says so ("unit tests never sleep:
 * inject the delay, clock or window as an option"); this guard is what keeps it true. A zero-delay
 * `setTimeout(r, 0)` is a turn of the event loop, not a wait, and is allowed. Integration tests
 * (`*.integration.test.ts`) run real processes and are not measured.
 *
 * Today's offenders are pinned in `test-determinism-baseline.json` with their counts. The suite
 * fails when a new file waits or binds a port, when a pinned file gets more, or when a pinned file
 * got better but keeps its old pin (the list only shrinks). After fixing some, rewrite it:
 *
 *   TEST_DETERMINISM_BASELINE=write bun test scripts/test-determinism-guard.test.ts
 *
 * (writing only lowers counts and drops fixed files; it never adds or raises one.)
 */

const repoRoot = resolve(import.meta.dir, '..')
const BASELINE_PATH = resolve(repoRoot, 'scripts/test-determinism-baseline.json')

const readBaseline = (): Record<string, Counts> =>
  JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Record<string, Counts>

describe('unit tests never wait on the real clock or a fixed port', () => {
  test('the rules see what they are for', () => {
    expect(countsOf('await new Promise((r) => setTimeout(r, 30))')).toEqual({ sleep: 1 })
    expect(countsOf('await Bun.sleep(5)')).toEqual({ sleep: 1 })
    expect(countsOf('await new Promise((r) => setTimeout(r, 0))')).toEqual({})
    expect(countsOf('// setTimeout(r, 30) in a comment')).toEqual({})
    expect(countsOf('Bun.serve({ port: 5050, fetch })')).toEqual({ port: 1 })
    expect(countsOf('Bun.serve({ port: 0, fetch })')).toEqual({})
    expect(countsOf('const target = { host: "db", port: 5432 }')).toEqual({})
    expect(countsOf('server.listen(8080)')).toEqual({ port: 1 })
  })

  test('no file waits or binds more than the baseline allows, and fixed files leave it', () => {
    const now = measure()
    const pinned = readBaseline()
    if (process.env.TEST_DETERMINISM_BASELINE === 'write') {
      const next: Record<string, Counts> = {}
      for (const [path, counts] of Object.entries(pinned)) {
        const lowered: Counts = {}
        for (const [rule, max] of Object.entries(counts) as [Rule, number][]) {
          const found = now[path]?.[rule] ?? 0
          if (found > 0) lowered[rule] = Math.min(found, max)
        }
        if (Object.keys(lowered).length > 0) next[path] = lowered
      }
      writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`)
      return
    }
    const problems: string[] = []
    for (const [path, counts] of Object.entries(now)) {
      for (const [rule, found] of Object.entries(counts) as [Rule, number][]) {
        const allowed = pinned[path]?.[rule] ?? 0
        if (found > allowed)
          problems.push(
            `${path}: ${found} ${rule} (allowed ${allowed}) — inject the clock or delay, or use port 0`,
          )
      }
    }
    for (const [path, counts] of Object.entries(pinned)) {
      for (const [rule, allowed] of Object.entries(counts) as [Rule, number][]) {
        if ((now[path]?.[rule] ?? 0) < allowed)
          problems.push(
            `${path}: ${rule} is down to ${now[path]?.[rule] ?? 0} from ${allowed} — rewrite the baseline (TEST_DETERMINISM_BASELINE=write)`,
          )
      }
    }
    expect(problems).toEqual([])
  })
})
