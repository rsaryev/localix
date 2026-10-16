/**
 * Bounded, breadth-preserving tracked-diff capture for model context.
 *
 * The normal fast path remains one `git diff`. Only when its process output cap
 * is exceeded do callers use this module: `--numstat -z` supplies a cheap full
 * manifest, we select authored/test files by salience plus patch-position
 * spread, then capture each selected path under its own small buffer ceiling.
 * A giant first file can therefore no longer hide every later file.
 */
import { mapLimit } from '../support/map-limit'
import { salientAndSpread } from '../support/spread-sample'
import type { GitRunner } from './cli'

const TRACKED_DIFF_CONCURRENCY = 6

export interface DiffPathStat {
  path: string
  /** Added lines; 0 for a binary file (git prints `-`). */
  insertions: number
  /** Removed lines; 0 for a binary file. */
  deletions: number
  binary?: boolean
  changedLines: number
  index: number
  signal: 'source' | 'test' | 'generated'
}

function pathSignal(path: string): DiffPathStat['signal'] {
  const normalized = `/${path.replace(/\\/g, '/').toLocaleLowerCase()}`
  const generated =
    /\/(?:dist|build|coverage|generated|vendor|snapshots?)(?:\/|$)/i.test(normalized) ||
    /\/(?:bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|[^/]+\.snap)$/i.test(normalized)
  const test =
    /\/(?:__tests__|tests?|specs?)(?:\/|$)/i.test(normalized) ||
    /\.(?:test|spec)\.[^/]+$/i.test(normalized)
  return generated ? 'generated' : test ? 'test' : 'source'
}

function lineCount(raw: string): number {
  if (raw === '-') return 0 // binary
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/** Parse `git diff --numstat -z`, including its three-NUL rename/copy form. */
export function parseNulNumstat(raw: string): DiffPathStat[] {
  const records = raw.split('\0')
  const output: DiffPathStat[] = []
  for (let cursor = 0; cursor < records.length; cursor++) {
    const record = records[cursor]
    if (!record) continue
    const firstTab = record.indexOf('\t')
    const secondTab = firstTab < 0 ? -1 : record.indexOf('\t', firstTab + 1)
    if (firstTab < 0 || secondTab < 0) continue
    const additions = record.slice(0, firstTab)
    const removals = record.slice(firstTab + 1, secondTab)
    let path = record.slice(secondTab + 1)
    if (!path) {
      // With -z, rename/copy rows encode an empty pathname in the numstat
      // header, then old-path NUL new-path NUL. The destination is the path Git
      // accepts for a path-scoped diff of the resulting change.
      cursor++ // old path
      path = records[++cursor] ?? '' // destination path
    }
    if (!path) continue
    const insertions = lineCount(additions)
    const deletions = lineCount(removals)
    output.push({
      path,
      insertions,
      deletions,
      ...(additions === '-' || removals === '-' ? { binary: true } : {}),
      changedLines: insertions + deletions,
      index: output.length,
      signal: pathSignal(path),
    })
  }
  return output
}

/** Prefer authored source, reserve test evidence, and sample generated output last. */
export function selectRepresentativeDiffPaths(
  entries: DiffPathStat[],
  limit: number,
): DiffPathStat[] {
  if (entries.length <= limit) return entries
  if (limit <= 0) return []
  const source = entries.filter((entry) => entry.signal === 'source')
  const tests = entries.filter((entry) => entry.signal === 'test')
  const generated = entries.filter((entry) => entry.signal === 'generated')
  const reservedTests =
    source.length > 0 && tests.length > 0 ? Math.min(tests.length, Math.max(1, limit >> 2)) : 0
  const selected = salientAndSpread(source, Math.min(source.length, limit - reservedTests))
  selected.push(...salientAndSpread(tests, Math.min(tests.length, limit - selected.length)))
  if (selected.length < limit) {
    const selectedIndexes = new Set(selected.map((entry) => entry.index))
    const remainingAuthored = [...source, ...tests].filter(
      (entry) => !selectedIndexes.has(entry.index),
    )
    selected.push(
      ...salientAndSpread(
        remainingAuthored,
        Math.min(remainingAuthored.length, limit - selected.length),
      ),
    )
  }
  selected.push(...salientAndSpread(generated, Math.max(0, limit - selected.length)))
  // Keep the salience order rather than restoring patch order. Every selected
  // file still carries its original index for spread sampling, while the next
  // bounded renderer sees the strongest files first even when every per-file
  // process hit the same byte cap (and therefore their captured line counts tie).
  return selected
}

export async function captureRepresentativeTrackedDiff(
  run: GitRunner,
  baseArgs: string[],
  rawNumstat: string,
  options: { maxFiles: number; maxBufferBytes: number },
): Promise<string> {
  const selected = selectRepresentativeDiffPaths(parseNulNumstat(rawNumstat), options.maxFiles)
  const patches = await mapLimit(selected, TRACKED_DIFF_CONCURRENCY, async ({ path }) => {
    const result = await run(
      [...baseArgs, '--', path],
      undefined,
      undefined,
      options.maxBufferBytes,
    )
    // execFile keeps the valid prefix captured before maxBuffer. A path that
    // vanished in a concurrent edit simply contributes no evidence; the exact
    // status inventory remains authoritative downstream.
    return /^diff --git /m.test(result.stdout) ? result.stdout : ''
  })
  return patches.filter(Boolean).join('\n')
}
