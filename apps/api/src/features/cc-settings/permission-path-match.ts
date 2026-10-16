import { globToRegExpSource } from './path-glob'
import { specifierIsAll } from './permission-value-match'
import type { CcRuleCall, CcTier } from './permission-rules'

/** Anchored path match: the whole absolute path against an anchored path glob. */
function fullPathMatch(pattern: string, absPath: string): boolean {
  try {
    return new RegExp(`^${globToRegExpSource(pattern)}$`).test(absPath)
  } catch {
    return false
  }
}

/** Match a bare (un-anchored) pattern at any path depth (basename or subpath suffix). */
function anyDepthMatch(pattern: string, absPath: string): boolean {
  try {
    return new RegExp(`(^|/)${globToRegExpSource(pattern)}$`).test(absPath)
  } catch {
    return false
  }
}

/** Resolve a path specifier's anchor into an absolute glob pattern, or `null` (bare). */
function anchorPattern(
  spec: string,
  root: string | undefined,
  home: string | undefined,
): string | null {
  if (spec.startsWith('//')) return '/' + spec.slice(2)
  if (spec.startsWith('~/')) return home ? joinPath(home, spec.slice(2)) : null
  if (spec.startsWith('./')) return root ? joinPath(root, spec.slice(2)) : null
  if (spec.startsWith('/')) return root ? joinPath(root, spec.slice(1)) : null
  return null // bare → any-depth match
}

/** Minimal path join that keeps glob chars intact (no fs normalization of `*`). */
function joinPath(a: string, b: string): string {
  return a.replace(/\/+$/, '') + '/' + b.replace(/^\/+/, '')
}

function matchOnePath(spec: string, absPath: string, root?: string, home?: string): boolean {
  const anchored = anchorPattern(spec, root, home)
  if (anchored !== null) return fullPathMatch(anchored, absPath)
  // Bare pattern → match at any depth (basename or subpath suffix).
  return anyDepthMatch(spec, absPath)
}

export function matchPaths(
  specifier: string | undefined,
  targets: string[],
  call: CcRuleCall,
  tier: CcTier,
): boolean {
  if (specifierIsAll(specifier)) return true
  if (targets.length === 0) return false
  const spec = specifier!
  const test = (p: string) => matchOnePath(spec, p, call.root, call.home)
  return tier === 'allow' ? targets.every(test) : targets.some(test)
}
