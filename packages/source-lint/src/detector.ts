/**
 * The detector: the three moving parts every source lint runs on, behind ONE seam.
 *
 * The seam exists so the kit can be mutated in-process and watched to fail. A kit whose own tests
 * cannot fail has not solved the problem — it has moved it up a level, which is strictly worse,
 * because now one broken assumption fails open across every lint at once instead of one.
 *
 * `auditDetector` (control.ts) takes a `SourceDetector` and returns the ways it is BLIND. Passing
 * the real one must return no findings; passing a detector whose `strip` returns `''`, or whose
 * `strip` is the identity, or whose `walk` does not recurse, must return findings. That is the
 * mutation matrix, and it runs as an ordinary unit test.
 */
import { readFileSync } from 'node:fs'
import { codeOnly } from './code'
import { walkSources } from './tree'

export interface SourceDetector {
  /** Blank comments, preserving offsets. */
  readonly strip: (source: string) => string
  /** Every source file under a directory, recursively. */
  readonly walk: (dir: string) => string[]
  /** Read a file's raw bytes as text. Throws when the file is not there — never `''`. */
  readonly readRaw: (file: string | URL) => string
}

/** The real one. Every lint in `packages/**` and `plugins/**` reads through exactly this. */
export const sourceDetector: SourceDetector = {
  strip: codeOnly,
  walk: walkSources,
  readRaw: (file) => readFileSync(file, 'utf8'),
}
