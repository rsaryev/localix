// Pure path helpers for the file-tree sidebar. No React / DOM / network — just
// string math over `/`-separated workspace paths, so the tree's reveal + parent
// logic stays unit-testable and out of the component.

import { isAtOrUnder } from '@localixai/path-containment/ancestry'

import type { DirEntry } from '@/shared/api/contracts'

/** A row as it appears in the flattened, top-to-bottom visible tree order. */
export interface VisibleRow {
  path: string
  name: string
  type: 'file' | 'dir'
}

/** Parent directory of a path ("/a/b/c.ts" → "/a/b"); root-or-bare → "/". */
export const dirname = (p: string): string => {
  const i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

/**
 * Ancestor DIRECTORY paths to expand so `filePath` is revealed under `root`,
 * outermost-first. Returns null when the file isn't inside `root` (caller skips
 * — nothing to reveal). The file's OWN segment is excluded: only its containing
 * folders need expanding.
 *
 *   revealAncestors("/p", "/p/a/b/c.ts") → ["/p/a", "/p/a/b"]
 *   revealAncestors("/p", "/p/c.ts")     → []     (file sits directly at root)
 *   revealAncestors("/p", "/p")          → []     (the root itself)
 *   revealAncestors("/p", "/other/x.ts") → null   (outside root)
 */
/**
 * Whether dragging the entry at `sourcePath` into directory `destDir` is a legal
 * move: not a no-op (already in `destDir`), not onto itself, and not into its own
 * subtree. The server enforces the same guards, this just gates the UI drop affordance.
 *
 *   canMoveInto("/p/a.ts", "/p")      → false  (already there)
 *   canMoveInto("/p/a.ts", "/p/sub")  → true
 *   canMoveInto("/p/dir", "/p/dir")   → false  (onto itself)
 *   canMoveInto("/p/dir", "/p/dir/x") → false  (into a descendant)
 */
export function canMoveInto(sourcePath: string, destDir: string): boolean {
  if (dirname(sourcePath) === destDir) return false
  // Reject dropping an entry onto itself or into its own subtree — ancestry via the
  // owner (`@localixai/path-containment/ancestry`), so the sibling-prefix trap is closed
  // once, here as everywhere. Server paths are POSIX, so `/` is the separator.
  if (isAtOrUnder(sourcePath, destDir)) return false
  return true
}

/** Last path segment. POSIX-only: the file tree speaks server paths, always `/`. */
export const basenameOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

const EMPTY_SET: ReadonlySet<string> = new Set()

/**
 * The "compact folder" chain for a directory `head`: the run of single-directory-child descendants folded into
 * one breadcrumb row. Returns the ordered segment paths, `head` first; a length-1
 * result means NO folding (render `head` as an ordinary row).
 *
 * The chain grows from `head` while the current folder's children are KNOWN and are
 * exactly one entry that is itself a directory. It stops as soon as a folder:
 *   - has 0 or ≥2 children, or a non-directory child (structural end — folder INCLUDED
 *     as the tail so its children render on expand), or
 *   - has unloaded children (can't fold blindly — fetch-on-expand still applies), or
 *   - is explicitly present in `expanded` (the user drilled to that level, so its
 *     children render there; folding stops at it).
 *
 *   computeCompactChain("/p/src", { "/p/src":[dir main], "/p/src/main":[dir java],
 *                                   "/p/src/main/java":[file A, file B] })
 *     → ["/p/src", "/p/src/main", "/p/src/main/java"]   // java = tail (2 files)
 */
export function computeCompactChain(
  head: string,
  childrenByPath: Record<string, DirEntry[]>,
  expanded: ReadonlySet<string> = EMPTY_SET,
): string[] {
  const segments = [head]
  let current = head
  // Bounded loop — guards against a pathological cache; real trees are far shallower.
  for (let i = 0; i < 256; i++) {
    if (expanded.has(current)) break // drilled-to level → children render here
    const entries = childrenByPath[current]
    if (!entries) break // unloaded → don't fold past the unknown
    if (entries.length === 1 && entries[0].type === 'dir') {
      current = `${current}/${entries[0].name}`
      segments.push(current)
      continue
    }
    break // 0 / ≥2 children, or a non-dir child → structural tail
  }
  return segments
}

/**
 * Folders to add to the expanded set so `filePath` is revealed under `root` WITH
 * compact chains kept folded — the minimal set of chain tails covering the reveal
 * path (vs. naively expanding every ancestor, which un-folds the whole branch).
 * Returns null when the file isn't inside `root` (caller skips, nothing to reveal).
 *
 * Each returned tail is an ancestor directory of `filePath`; expanding it lets the
 * next path segment (or the file itself) render, while `computeCompactChain` still
 * folds the single-child run leading to it.
 */
export function compactExpandTargets(
  root: string,
  filePath: string,
  childrenByPath: Record<string, DirEntry[]>,
): string[] | null {
  const ancestors = revealAncestors(root, filePath)
  if (!ancestors) return null
  const targets: string[] = []
  let idx = 0
  while (idx < ancestors.length) {
    const head = ancestors[idx]
    const chain = computeCompactChain(head, childrenByPath) // structural (ignore expanded)
    const tail = chain[chain.length - 1]
    targets.push(tail)
    const at = ancestors.indexOf(tail)
    idx = (at >= idx ? at : idx) + 1
  }
  return targets
}

/**
 * Collapse a set of paths to its "distinct parents": drop any path whose
 * ancestor folder is also present, so a batch delete/move never operates on
 * both a folder and something already inside it. Output is de-duplicated and sorted.
 *
 *   distinctParents(["/p/a", "/p/a/b.ts", "/p/c"]) → ["/p/a", "/p/c"]
 */
export function distinctParents(paths: readonly string[]): string[] {
  const sorted = [...new Set(paths)].sort()
  const out: string[] = []
  for (const p of sorted) {
    if (!out.some((a) => isAtOrUnder(a, p))) out.push(p)
  }
  return out
}

export function revealAncestors(root: string, filePath: string): string[] | null {
  if (!isAtOrUnder(root, filePath)) return null
  const rel = filePath.slice(root.length).split('/').filter(Boolean)
  const ancestors: string[] = []
  let acc = root
  for (let i = 0; i < rel.length - 1; i++) {
    acc += `/${rel[i]}`
    ancestors.push(acc)
  }
  return ancestors
}
