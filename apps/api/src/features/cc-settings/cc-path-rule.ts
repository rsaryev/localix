/**
 * Claude Code's `Read(path)` / `Edit(path)` and `WebFetch(domain:…)` specifiers matched exactly as
 * permissions.md describes them, for a hook's `if` (`cc-hooks/if-guard.ts`).
 *
 * Paths ("How path patterns match"): gitignore patterns with four anchors — `//p` the filesystem
 * root, `~/p` home, `/p` the project, `p` / `./p` the working directory. A pattern with no `/`
 * but a trailing one is a name at any depth below its anchor (`.env`, `*.ts`); one with a `/`
 * names that path below its anchor (`src/**` is the working directory's `src`, not
 * `lib/src`); a directory names everything below it.
 *
 * Domains ("WebFetch"): case-insensitive, a trailing `.` dropped; `*.host` any subdomain at any
 * depth but not the host itself; `*` every host; any other `*` stands for one label.
 */
import { homedir } from 'node:os'
import { posix } from 'node:path'

import { globToRegExpSource } from './path-glob'

interface Anchors {
  cwd: string
  /** Where a `/p` pattern anchors: the project (permissions.md, "Where a pattern anchors"). */
  projectDir?: string
  /** Where a `~/p` pattern anchors; the OS account's home by default. */
  homeDir?: string
}

function anchored(spec: string, anchors: Anchors): { base: string; rel: string } {
  if (spec.startsWith('//')) return { base: '/', rel: spec.slice(2) }
  if (spec === '~' || spec.startsWith('~/'))
    return { base: anchors.homeDir ?? homedir(), rel: spec.slice(2) }
  if (spec.startsWith('/')) return { base: anchors.projectDir ?? anchors.cwd, rel: spec.slice(1) }
  return { base: anchors.cwd, rel: spec.replace(/^\.\//, '') }
}

/** Does this path specifier name this absolute path? A malformed glob names nothing. */
export function ccPathRuleMatches(specifier: string, path: string, anchors: Anchors): boolean {
  const spec = specifier.trim()
  if (!spec) return false
  const { base, rel } = anchored(spec, anchors)
  const target = posix.normalize(path)
  const root = posix.normalize(base).replace(/\/$/, '')
  if (target !== root && !target.startsWith(`${root}/`)) return false
  const inside = target === root ? '' : target.slice(root.length + 1)
  const pattern = rel.replace(/\/$/, '')
  if (!pattern) return true
  const anyDepth = !spec.startsWith('/') && !spec.startsWith('~') && !pattern.includes('/')
  try {
    const source = globToRegExpSource(pattern)
    // A matched directory names everything below it, as gitignore's patterns do.
    return new RegExp(`${anyDepth ? '(^|/)' : '^'}${source}(/.*)?$`).test(inside)
  } catch {
    return false
  }
}

/** Does this `domain:` specifier name this URL's host? */
export function ccDomainRuleMatches(specifier: string, url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return false
  }
  const rule = specifier
    .replace(/^domain:/, '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
  if (!rule) return false
  if (rule === '*') return true
  if (rule.startsWith('*.')) return host.endsWith(`.${rule.slice(2)}`)
  const label = rule
    .split('.')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]*'))
    .join('\\.')
  return new RegExp(`^${label}$`).test(host)
}
