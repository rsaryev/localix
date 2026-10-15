/**
 * The walker, and the assertion that the walker actually found something.
 *
 * A source lint whose goal state is "no offenders" cannot be falsified by counting offenders: an
 * empty result is indistinguishable from a clean tree. The wire lints walked exactly ONE directory
 * level, which was true of the tree as it happened to be laid out and false of the rule they
 * enforced — a drop-in that put its wire at `providers/<id>/wire/sse.mjs` was simply never opened,
 * and every rule reported no offender because it never looked.
 *
 * So the walker here recurses, and `sourceTree` REFUSES to hand back a file list that does not
 * contain the witnesses the caller named. Move the code and the lint goes red, which is the only
 * behaviour that makes the green mean anything.
 */
import { readdirSync, statSync, type Dirent } from 'node:fs'
import { join } from 'node:path'

/**
 * Never walked: build output, dependencies, VCS. Deliberately SHORT — every name added here is a
 * tree the lints stop seeing, and a lint that stops seeing a tree reports it clean.
 */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.turbo',
])

/** A first-party, non-test source file — the only thing a lint has any business reading. */
export function isSourceFile(file: string): boolean {
  return /\.(ts|tsx|mjs|cjs|js|jsx)$/.test(file) && !/\.test\.(ts|tsx|mjs|cjs|js|jsx)$/.test(file)
}

/**
 * Every source file under `dir`, RECURSIVELY. A missing root yields `[]` — an optional tree (a
 * drop-in root, a package absent from a partial checkout) is not an error, which is exactly why
 * `sourceTree` below insists the caller prove the tree it cared about was actually there.
 */
export function walkSources(dir: string): string[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    // The entry type comes with the listing; only a symlink needs a stat to see its target.
    let isDirectory = entry.isDirectory()
    if (entry.isSymbolicLink()) {
      try {
        isDirectory = statSync(full).isDirectory()
      } catch {
        continue // a symlink that dangles mid-walk
      }
    }
    if (isDirectory) files.push(...walkSources(full))
    else if (isSourceFile(entry.name)) files.push(full)
  }
  return files
}

export class EmptyScanError extends Error {
  override readonly name = 'EmptyScanError'
}

export interface SourceTreeOptions {
  /** Roots to walk. Absent roots contribute nothing — that is what `mustInclude` is for. */
  readonly roots: readonly string[]
  /**
   * Witnesses the scan MUST have found: a path suffix, or a pattern over the absolute path. This is
   * the anti-void assertion. A lint that names its subject here goes RED when the subject is moved,
   * renamed, or deleted — instead of silently checking an empty set and passing.
   */
  readonly mustInclude?: readonly (string | RegExp)[]
  /** Floor on the file count. A cheap second proof the walk did not collapse to nothing. */
  readonly minFiles?: number
  /** Names the scan in the failure message, e.g. `'the provider wires'`. */
  readonly label?: string
}

/**
 * Walk `roots` and PROVE the scan found its subject before returning it.
 *
 * Throws `EmptyScanError` rather than returning an empty (or subject-less) list, because the caller's
 * assertion is `expect(offenders).toEqual([])` — which an empty scan satisfies perfectly.
 */
export function sourceTree(options: SourceTreeOptions): string[] {
  const { roots, mustInclude = [], minFiles = 1, label = 'the scanned sources' } = options
  const files = roots.flatMap(walkSources)

  if (files.length < minFiles) {
    throw new EmptyScanError(
      `${label}: the scan found ${files.length} file(s), fewer than the ${minFiles} it requires.\n` +
        `Roots walked:\n${roots.map((r) => `  - ${r}`).join('\n')}\n` +
        'A source lint that scans nothing reports no violations — it fails OPEN. Either a root moved, ' +
        'or this lint is now pointed at empty air.',
    )
  }

  const missing = mustInclude.filter((witness) =>
    typeof witness === 'string'
      ? !files.some((f) => f.endsWith(witness))
      : !files.some((f) => witness.test(f)),
  )
  if (missing.length > 0) {
    throw new EmptyScanError(
      `${label}: the scan did not find ${missing.map((w) => `\`${String(w)}\``).join(', ')}.\n` +
        'These are the witnesses this lint was told it must be able to see. Their absence means the ' +
        'scan is no longer reading the code it exists to guard — so its green is meaningless. If the ' +
        'code legitimately moved, point the roots at where it went and update the witnesses.',
    )
  }
  return files
}
