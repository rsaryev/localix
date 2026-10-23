/**
 * Claude Code `permissions` rule grammar: `Tool` / `Tool(specifier)`.
 *
 * The hook `if` guard (`cc-hooks/if-guard.ts`) reads Claude Code rule strings with this parser
 * and matches them with the Bash/value helpers re-exported here. Supported grammar (a documented
 * SUBSET of full CC — see docs/features/permissions.md):
 *   - Bare tool name (`Bash`, `Edit`, `mcp__server`).
 *   - `Bash(prefix:*)` / `Bash(prefix *)` word-boundary prefix, `Bash(ls*)` raw
 *     prefix, `Bash(git * --x)` glob, `Bash(exact cmd)` exact.
 *   - Path globs (`**`, `*`, `?`, `{a,b}`, `[a-z]` — `path-glob.ts`).
 *   - `Skill(name)` / `Skill(name *)` value prefixes.
 *
 * Pure module — no chat/UI imports.
 */
import { splitCompoundCommand } from '../agent-core/tools/bash/bash-command-shape'
import { globToRegExpSource } from './path-glob'

export { specifierIsAll, specifierMatchesValue, matchBashSpecifier } from './permission-value-match'

/** Split `Tool(specifier)` → `{ tool, specifier }`; bare `Tool` → no specifier. */
export function parseRuleString(raw: string): { tool: string; specifier?: string } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const m = /^([^()]+)\((.*)\)$/s.exec(trimmed)
  if (!m) return { tool: trimmed }
  return { tool: m[1]!.trim(), specifier: m[2]! }
}

/**
 * PATH globs (hook file guards, skill `paths:`) compile through the one picomatch-backed
 * compiler, so braces and classes work; re-exported so its importers keep reaching it through
 * this module.
 */
export { globToRegExpSource }

/**
 * Re-exported: the splitter lives in agent-core beside the read-only classifier, because the
 * live permission engine needs the same decomposition and core must not import a compat
 * feature. A second copy is how the two answers drift apart.
 */
export { splitCompoundCommand as bashSubcommands }
