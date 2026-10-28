import { isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * Lexical containment: whether a path stays inside a root by its spelling. It follows no link, so a
 * caller that must not cross one compares real paths (`fs.realpath`) instead. An empty root or
 * candidate is never contained, so an unset root cannot quietly become the working directory.
 */
function inside(root: string, candidate: string): string | null {
  if (!root || !candidate) return null
  const rel = relative(resolve(root), resolve(candidate))
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null
  return rel
}

/** `candidate` is `root` itself or below it. */
export function isPathWithin(root: string, candidate: string): boolean {
  return inside(root, candidate) !== null
}

/** `candidate` is strictly below `root`. */
export function isPathBelow(root: string, candidate: string): boolean {
  const rel = inside(root, candidate)
  return rel !== null && rel !== ''
}

/** `target` resolved against `root`, or null when it leaves it. */
export function resolveWithin(root: string, target: string): string | null {
  const path = resolve(root, target)
  return isPathWithin(root, path) ? path : null
}
