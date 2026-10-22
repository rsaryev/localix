import { splitCompoundCommand } from '../agent-core/tools/bash/bash-command-shape'
import type { CcRuleCall, CcTier } from './permission-rules'

/**
 * Compile a VALUE specifier (Skill, Agent, MCP; Bash has its own) to a regex SOURCE: `**\/` →
 * optional intermediate dirs, `**` → any, `*` → one segment, `?` → one char — and
 * everything else escaped. This stays wildcard-only on purpose: a command is not a path,
 * and `Bash(echo {a,b} *)` or `Bash(python -c print(1) *)` must match the braces and
 * parentheses the person typed, not expand them as glob syntax.
 */
function wildcardToRegExpSource(glob: string): string {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') {
          i++
          out += '(?:.*/)?' // `**/` → optional intermediate dirs
        } else {
          out += '.*'
        }
      } else {
        out += '[^/]*'
      }
    } else if (c === '?') {
      out += '[^/]'
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return out
}

function fullGlobMatch(pattern: string, value: string): boolean {
  try {
    return new RegExp(`^${wildcardToRegExpSource(pattern)}$`).test(value)
  } catch {
    return false
  }
}

/**
 * A Bash specifier's wildcard match: every `*` stands in for any text, slashes included
 * (permissions.md: "Bash rules match the whole command text, with `*` standing in for any
 * text"); every other character is literal. A command is not a path, so `*` is not `[^/]*`.
 */
function bashWildcardMatch(pattern: string, command: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}$`, 's').test(command)
}

/** True when a specifier means "any invocation" (absent, empty, or `*`). */
export function specifierIsAll(specifier: string | undefined): boolean {
  if (specifier === undefined) return true
  const t = specifier.trim()
  return t === '' || t === '*'
}

/** Generic value match (skill/agent/other): `prefix *` / `prefix:*` prefix, `*` glob, else exact. */
export function specifierMatchesValue(specifier: string, value: string): boolean {
  const spec = specifier.trim()
  const v = value.trim()
  if (spec.endsWith(':*')) return v.startsWith(spec.slice(0, -2).trim())
  if (spec.endsWith(' *')) return v.startsWith(spec.slice(0, -2).trim())
  if (spec.includes('*')) return fullGlobMatch(spec, v)
  return v === spec
}

/** Bash specifier match with CC word-boundary semantics against ONE subcommand. */
export function matchBashSpecifier(specifier: string, cmd: string): boolean {
  const spec = specifier.trim()
  const v = cmd.trim()
  // `prefix:*` and `prefix *` both mean a word-boundary prefix — when that trailing `*` is the
  // rule's only wildcard: `Bash(* --help *)` matches `npm --help x` but not `npm --help`.
  if ((spec.endsWith(':*') || spec.endsWith(' *')) && !spec.slice(0, -2).includes('*')) {
    const prefix = spec.slice(0, -2).trim()
    return v === prefix || v.startsWith(prefix + ' ')
  }
  // `ls*` — raw prefix, no boundary (matches `lsof` too).
  if (spec.endsWith('*') && !spec.slice(0, -1).includes('*')) {
    return v.startsWith(spec.slice(0, -1))
  }
  if (spec.includes('*')) return bashWildcardMatch(spec, v)
  return v === spec
}

export function matchBash(specifier: string | undefined, call: CcRuleCall, tier: CcTier): boolean {
  if (specifierIsAll(specifier)) return true
  if (call.command === undefined || call.command.trim() === '') return false
  const subs = splitCompoundCommand(call.command)
  if (subs === null) return false // substitution — can't confidently match
  const spec = specifier!
  return tier === 'allow'
    ? subs.every((s) => matchBashSpecifier(spec, s)) // allow: EVERY subcommand must match
    : subs.some((s) => matchBashSpecifier(spec, s)) // deny/ask: ANY subcommand matches
}
