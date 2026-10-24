import { join } from 'node:path'

import { globToRegExpSource } from './path-glob'

/**
 * A `Read(…)` or `Edit(…)` path of a Claude Code settings rule against a file, with gitignore
 * semantics and Claude Code's four anchors (permissions.md, "How path patterns match", "Where a
 * pattern anchors", "How deep a pattern matches"):
 *
 *   `//path`   from the filesystem root
 *   `~/path`   from the home directory
 *   `/path`    from the directory of the settings source (the project, or the config dir)
 *   `./path`   from the working directory
 *   `path`     from the working directory; a bare name matches at any depth beneath it, and a
 *              single directory segment (`src/**`) does too in a deny or ask rule
 *
 * A pattern that names a directory also covers what is inside it.
 */

export interface PathAnchors {
  cwd: string
  homeDir: string
  /** The rule's settings source directory, for a `/path` pattern. */
  sourceDir: string
}

function patternGlob(spec: string, effect: 'allow' | 'ask' | 'deny', at: PathAnchors): string {
  if (spec.startsWith('//')) return spec.slice(1)
  if (spec === '~' || spec.startsWith('~/')) return join(at.homeDir, spec.slice(2))
  if (spec.startsWith('/')) return join(at.sourceDir, spec.slice(1))
  if (spec.startsWith('./')) return join(at.cwd, spec.slice(2))
  const rel = spec.replace(/\/+$/, '')
  const segments = rel.split('/')
  const bareName = segments.length === 1
  const oneDirectory = segments.length === 2 && segments[1] === '**' && !segments[0]!.includes('*')
  const anyDepth = bareName || (oneDirectory && effect !== 'allow')
  return anyDepth && !rel.startsWith('**/') ? `${at.cwd}/**/${rel}` : join(at.cwd, rel)
}

function compile(glob: string): RegExp | null {
  try {
    const source = globToRegExpSource(glob)
    // A path inside a matched directory is matched too.
    return new RegExp(`^${source}(?:/.*)?$`)
  } catch {
    return null
  }
}

export function pathRuleMatches(
  spec: string,
  effect: 'allow' | 'ask' | 'deny',
  path: string,
  at: PathAnchors,
): boolean {
  const trimmed = spec.trim()
  if (!trimmed) return false
  const regex = compile(patternGlob(trimmed, effect, at))
  // A deny or ask path that is not a usable pattern still guards that exact path.
  if (!regex) return effect !== 'allow' && path === patternGlob(trimmed, effect, at)
  return regex.test(path)
}

/**
 * Whether the paths a call touches meet one source's list of path rules for one effect, with
 * `!` carve-outs: a `!pattern` removes what it matches from the plain `path` / `./path` rules
 * listed before it, never from an anchored one, nor from inside a directory blocked whole.
 */
export function pathListMatches(
  specs: readonly string[],
  effect: 'allow' | 'ask' | 'deny',
  path: string,
  at: PathAnchors,
): string | undefined {
  let matched: string | undefined
  let carvable = false
  for (const spec of specs) {
    if (spec.startsWith('!')) {
      if (matched && carvable && pathRuleMatches(spec.slice(1), effect, path, at))
        matched = undefined
      continue
    }
    if (!matched && pathRuleMatches(spec, effect, path, at)) {
      matched = spec
      carvable = !/^(\/|~|\.\/\.\.)/.test(spec) && !spec.endsWith('/**')
    }
  }
  return matched
}
