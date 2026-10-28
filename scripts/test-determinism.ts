import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * What `test-determinism-guard.test.ts` measures: per file, how many times a unit test (or a
 * helper tests share) waits on the real clock or binds a fixed port.
 */

const repoRoot = resolve(import.meta.dir, '..')

export type Rule = 'sleep' | 'port'
export type Counts = Partial<Record<Rule, number>>

/** What each rule counts, on a line with its comment removed. */
export const RULES: Record<Rule, RegExp> = {
  // A timer with a non-zero literal delay, or a sleep: a guess at how long something takes.
  sleep: /setTimeout\([^;]*?,\s*[1-9][\d_]*\s*\)|\bBun\.sleep\(|(?<![\w.])sleep\(\s*[1-9]/g,
  // A server bound to a fixed port (`Bun.serve({ port: 5050 })`, `.listen(5050)`); `port: 0` asks
  // the system for a free one. A port in data (`{ host, port: 5432 }`) binds nothing.
  port: /\bserve\(\{[^}]*\bport:\s*[1-9]\d{2,4}\b|\.listen\(\s*[1-9]\d{2,4}\b/g,
}

/** Unit tests and the helpers they share; integration tests and vendored code are not measured. */
function measuredFiles(): string[] {
  const listed = Bun.spawnSync(
    ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: repoRoot,
    },
  )
  return new TextDecoder()
    .decode(listed.stdout)
    .split('\0')
    .filter(
      (path) =>
        /\.(ts|tsx|mts|mjs)$/.test(path) &&
        !path.startsWith('vendor/') &&
        !path.includes('node_modules/') &&
        !/\.integration\.test\./.test(path) &&
        !/\.pw\./.test(path) &&
        path !== 'scripts/test-determinism-guard.test.ts' &&
        (/\.test\.(ts|tsx)$/.test(path) || /(^|\/)testing\//.test(path)),
    )
}

export function countsOf(source: string): Counts {
  const counts: Counts = {}
  for (const raw of source.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '')
    if (/^\s*\*/.test(line)) continue
    for (const [rule, pattern] of Object.entries(RULES) as [Rule, RegExp][]) {
      const found = line.match(pattern)?.length ?? 0
      if (found) counts[rule] = (counts[rule] ?? 0) + found
    }
  }
  return counts
}

export function measure(): Record<string, Counts> {
  const result: Record<string, Counts> = {}
  for (const path of measuredFiles()) {
    let source: string
    try {
      source = readFileSync(resolve(repoRoot, path), 'utf8')
    } catch {
      continue // listed but deleted in the working tree
    }
    const counts = countsOf(source)
    if (Object.keys(counts).length > 0) result[path] = counts
  }
  return result
}
