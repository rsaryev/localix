/**
 * Reading a source file, and locating the subject inside it.
 *
 * Both operations throw rather than degrade. `readCode` on a file that moved is an error, not an
 * empty string; `namedBody` for a function that was renamed is an error, not an empty scope. The
 * whole defect class this kit exists to kill is a lint that answers "your subject is gone" by
 * quietly checking nothing and passing — so every way of getting a subject in this module fails
 * LOUD when the subject is not there.
 */
import { type SourceDetector, sourceDetector } from './detector'

export class SubjectNotFoundError extends Error {
  override readonly name = 'SubjectNotFoundError'
}

/** Read a source file as CODE — comments blanked, offsets preserved. The only reader a lint uses. */
export function readCode(file: string | URL, detector: SourceDetector = sourceDetector): string {
  return detector.strip(detector.readRaw(file))
}

/**
 * The files, of `files`, whose CODE matches `rule`.
 *
 * A named function and not an inlined `.filter()` in each lint, so a positive control can exercise
 * the REAL detector instead of a re-typed copy of it. A control built from a second implementation
 * of the code under test proves only that the two copies agree — which they did, while both were
 * blind.
 */
export function offendersIn(
  files: readonly string[],
  rule: RegExp,
  detector: SourceDetector = sourceDetector,
): string[] {
  return files.filter((file) => rule.test(detector.strip(detector.readRaw(file))))
}

/**
 * The brace-matched BODY of a declaration whose header matches `header`, e.g. `async closePosition(`
 * or `const doCreateOrder =`.
 *
 * Located by a HEADER PATTERN and closed by BRACE MATCHING, never by a second literal anchor. The
 * ccxt lint used to bound its scope between two byte-exact source strings (`'async closePosition(symbol)'`
 * … up to `'async cancelAllOrders'`); annotate the parameter, reorder the methods, or reformat the
 * signature and the anchors miss, leaving the lint to slice a degenerate window and answer the very
 * change it exists to notice by checking something else.
 *
 * Throws when the subject is absent. That is the point.
 */
export function namedBody(code: string, header: RegExp, label = String(header)): string {
  const start = header.exec(code)
  if (!start) {
    throw new SubjectNotFoundError(
      `source lint: could not find \`${label}\` in the file it was told to read.\n` +
        'The lint cannot check a subject it cannot see, and "found no violation in nothing" reads ' +
        'exactly like "found no violation". If the subject was renamed or moved, point this lint at ' +
        'it; if it was deleted, delete the lint deliberately rather than letting it pass by accident.',
    )
  }
  const open = code.indexOf('{', start.index)
  if (open < 0) {
    throw new SubjectNotFoundError(
      `source lint: \`${label}\` has no body — no \`{\` follows its header.`,
    )
  }
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}' && --depth === 0) return code.slice(open, i + 1)
  }
  throw new SubjectNotFoundError(
    `source lint: \`${label}\` has an unbalanced body — its braces never close.`,
  )
}

/**
 * Assert a token IS present in `code`, and return where. An ordering lint ("the guard runs before
 * the native call") is only meaningful if BOTH sides were found — comparing `-1 < 42` is a pass by
 * accident.
 */
export function mustFind(code: string, pattern: RegExp, label = String(pattern)): number {
  const at = code.search(pattern)
  if (at < 0) {
    throw new SubjectNotFoundError(
      `source lint: \`${label}\` is not in the code under test.\n` +
        'It was there when this lint was written, and its presence is the thing being guarded.',
    )
  }
  return at
}
