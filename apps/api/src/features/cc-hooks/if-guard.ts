/**
 * CC hook `if` guard — a per-handler secondary filter using permission-rule
 * syntax, e.g. `Bash(git commit:*)`, `Edit(*.ts)`, or a bare `Bash`.
 *
 * Evaluated on tool events only (PreToolUse/PostToolUse) BEFORE the hook is
 * spawned, against the tool name + input. Exactly one rule per handler (no
 * `&&`/`||`). Best-effort — CC treats `if` as a soft filter, not a hard gate, so
 * we FAIL OPEN (the hook runs) on anything we can't confidently parse.
 *
 * Shape of a rule: `Tool(specifier)` or bare `Tool`.
 *   - The tool part matches via the shared CC↔engine name map (`Bash` ⇒ our
 *     `bash`), so authoring a rule with CC tool names works.
 *   - The specifier matches against a tool-specific field:
 *       Bash-family  → the `command` string (prefix/glob, subcommand-aware)
 *       file tools   → the `file_path` (glob)
 *       anything else → best-effort glob over the first stringy input value.
 *   - `prefix:*` and `prefix *` are prefix matches; a specifier containing `*`
 *     elsewhere is a glob; otherwise an exact match. Empty / `*` = tool-only.
 *
 * Pure module — no chat/UI imports.
 */
import { matchesToolName } from './matcher'
import {
  bashSubcommands,
  globToRegExpSource,
  matchBashSpecifier,
  parseRuleString,
  specifierIsAll,
  specifierMatchesValue,
} from '../cc-settings/permission-rules'

/**
 * Hook file guards historically treat a basename glob such as `*.ts` as matching
 * at any directory depth. Reuse the canonical glob compiler while preserving
 * that hook-specific path policy.
 */
function fileSpecifierMatchesValue(specifier: string, value: string): boolean {
  const spec = specifier.trim()
  const candidate = value.trim()
  if (!spec.includes('*') && !spec.includes('?')) {
    return specifierMatchesValue(spec, candidate)
  }
  try {
    const source = globToRegExpSource(spec)
    return new RegExp(spec.includes('/') ? `^${source}$` : `(^|/)${source}$`).test(candidate)
  } catch {
    return false
  }
}

/** Best-effort: pull the first string value out of a tool-input record. */
function firstStringValue(input: unknown): string | undefined {
  if (typeof input === 'string') return input
  if (input && typeof input === 'object') {
    for (const v of Object.values(input as Record<string, unknown>)) {
      if (typeof v === 'string') return v
    }
  }
  return undefined
}

function stringField(input: unknown, key: string): string | undefined {
  if (input && typeof input === 'object') {
    const v = (input as Record<string, unknown>)[key]
    if (typeof v === 'string') return v
  }
  return undefined
}

/**
 * Evaluate a handler `if` guard. Returns true when the hook SHOULD run.
 * Fails OPEN (returns true) whenever the rule can't be confidently applied.
 */
export function evaluateIfGuard(rule: string, engineToolName: string, toolInput: unknown): boolean {
  const parsed = parseRuleString(rule)
  if (!parsed) return true // unparseable rule → fail open
  // Tool part must match this call's tool (CC↔engine aware).
  if (!matchesToolName(parsed.tool, engineToolName)) return false
  if (specifierIsAll(parsed.specifier)) return true
  const specifier = parsed.specifier!

  const toolLower = engineToolName.toLowerCase()
  // Bash family: the specifier constrains the command string.
  if (toolLower === 'bash' || parsed.tool.trim().toLowerCase() === 'bash') {
    const command = stringField(toolInput, 'command')
    if (command === undefined) return true // no command to test → fail open
    const subs = bashSubcommands(command)
    if (subs === null) return true // substitution present → fail open
    return subs.some((s) => matchBashSpecifier(specifier, s))
  }

  // File tools: match the file_path; else the first stringy input value.
  const field =
    stringField(toolInput, 'file_path') ??
    stringField(toolInput, 'path') ??
    firstStringValue(toolInput)
  if (field === undefined) return true // nothing to test → fail open
  return fileSpecifierMatchesValue(specifier, field)
}
