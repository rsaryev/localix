import { ccPathRuleMatches } from './cc-path-rule'

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

/**
 * In a deny or ask rule a single directory segment (`secrets/**`) names that directory at any
 * depth (permissions.md, "How deep a pattern matches"); in an allow rule, and for every other
 * shape, the match stays where `cc-path-rule.ts` anchors it.
 */
function forEffect(spec: string, effect: 'allow' | 'ask' | 'deny'): string {
  if (effect === 'allow' || /^(\/|~|\.\/)/.test(spec)) return spec
  const segments = spec.replace(/\/+$/, '').split('/')
  const oneDirectory = segments.length === 2 && segments[1] === '**' && !segments[0]!.includes('*')
  return oneDirectory ? `**/${spec}` : spec
}

export function pathRuleMatches(
  spec: string,
  effect: 'allow' | 'ask' | 'deny',
  path: string,
  at: PathAnchors,
): boolean {
  const trimmed = spec.trim()
  if (!trimmed) return false
  return ccPathRuleMatches(forEffect(trimmed, effect), path, {
    cwd: at.cwd,
    projectDir: at.sourceDir,
    homeDir: at.homeDir,
  })
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
