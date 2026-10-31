/**
 * Claude Code `permissions` rule grammar: `Tool` / `Tool(specifier)`.
 *
 * The hook `if` guard (`cc-hooks/if-guard.ts`) reads Claude Code rule strings with this parser
 * and matches them with the Bash/value helpers of `permission-value-match.ts`. Supported grammar
 * (a documented SUBSET of full CC — see docs/features/permissions.md):
 *   - Bare tool name (`Bash`, `Edit`, `mcp__server`).
 *   - `Bash(prefix:*)` / `Bash(prefix *)` word-boundary prefix, `Bash(ls*)` raw
 *     prefix, `Bash(git * --x)` glob, `Bash(exact cmd)` exact.
 *   - Path globs (`**`, `*`, `?`, `{a,b}`, `[a-z]` — `path-glob.ts`).
 *   - `Skill(name)` / `Skill(name *)` value prefixes.
 *
 * Pure module — no chat/UI imports.
 */

/** Split `Tool(specifier)` → `{ tool, specifier }`; bare `Tool` → no specifier. */
export function parseRuleString(raw: string): { tool: string; specifier?: string } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const m = /^([^()]+)\((.*)\)$/s.exec(trimmed)
  if (!m) return { tool: trimmed }
  return { tool: m[1]!.trim(), specifier: m[2]! }
}
