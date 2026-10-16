import { createTwoFilesPatch } from 'diff'
import { baseName } from '@localixai/plugin-sdk/ui/utilities'

/**
 * Build a unified diff (parseable by `DiffView`) between two ARBITRARY files —
 * the "Select for Compare" → "Compare with Selected" flow. Unlike a git
 * diff (old⟷new of the SAME path), this compares two distinct on-disk files, so
 * the header names each side by its own basename.
 *
 * `aPath`/`bPath` are absolute paths (used only for the header labels); the diff
 * content comes from the passed contents so the caller controls exactly what is
 * compared (e.g. the on-disk bytes, not an unsaved buffer).
 */
export function buildCompareDiff(
  aPath: string,
  bPath: string,
  aContent: string,
  bContent: string,
): string {
  // Normalize a trailing newline on both sides so identical-but-for-EOF files
  // don't emit a spurious "\ No newline at end of file" marker on one side only.
  const a = aContent.endsWith('\n') ? aContent : `${aContent}\n`
  const b = bContent.endsWith('\n') ? bContent : `${bContent}\n`
  return createTwoFilesPatch(baseName(aPath), baseName(bPath), a, b, '', '', { context: 3 })
}

/** Stable, collision-free grid identity for a compare tab — kept distinct from a
 *  git diff of either path (whose id is keyed on the real path) so opening a
 *  compare never hijacks or is hijacked by an SCM diff tab. */
export function compareDiffPath(aPath: string, bPath: string): string {
  return `compare://${aPath}↔${bPath}`
}
