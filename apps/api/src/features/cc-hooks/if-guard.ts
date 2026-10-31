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
 *       file tools   → the `file_path` (glob); a batch matches when any of its paths does
 *       anything else → best-effort glob over the first stringy input value.
 *   - `prefix:*` and `prefix *` are prefix matches; a specifier containing `*`
 *     elsewhere is a glob; otherwise an exact match. Empty / `*` = tool-only.
 *
 * Pure module — no chat/UI imports.
 */
import { isAbsolute, resolve } from 'node:path'
import { mutationInputPaths } from '@localixai/agent/agents'

import { claudeCodeHookCall } from '../ext/cc-tool-shapes'
import { ccDomainRuleMatches, ccPathRuleMatches } from '../cc-settings/cc-path-rule'

import { matchesToolName } from './matcher'
import { parseRuleString } from '../cc-settings/permission-rules'
import { globToRegExpSource } from '../cc-settings/path-glob'
import {
  matchBashSpecifier,
  specifierIsAll,
  specifierMatchesValue,
} from '../cc-settings/permission-value-match'
// The splitter lives in agent-core beside the read-only classifier: the live permission engine
// needs the same decomposition, and a second copy is how the two answers drift apart.
import { splitCompoundCommand } from '../agent-core/tools/bash/bash-command-shape'

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

/** `Tool(param:value)`: one top-level scalar field of Claude Code's input (permissions.md). */
const PARAM_RULE = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/s

function paramMatches(specifier: string, view: Record<string, unknown>): boolean | undefined {
  if (specifier.trim().endsWith(':*')) return undefined // `prefix:*` is a prefix, not a field
  const m = PARAM_RULE.exec(specifier.trim())
  if (!m || !(m[1]! in view)) return undefined
  const value = view[m[1]!]
  if (value === undefined || (typeof value === 'object' && value !== null)) return false
  return specifierMatchesValue(m[2]!.trim(), String(value as string | number | boolean))
}

/** The files a call touches, absolute: a batch's every entry, else the Claude Code `file_path`. */
function callPaths(toolInput: unknown, view: Record<string, unknown>, base?: string): string[] {
  const own = [...mutationInputPaths(toolInput), ...filePathFields(toolInput)]
  const viewed = ['file_path', 'notebook_path', 'path'].flatMap((key) =>
    typeof view[key] === 'string' ? [view[key] as string] : [],
  )
  const absolute = (path: string) => (base && !isAbsolute(path) ? resolve(base, path) : path)
  return [...new Set([...own, ...viewed].map(absolute))]
}

/**
 * Evaluate a handler `if` guard. Returns true when the hook SHOULD run.
 * Fails OPEN (returns true) whenever the rule can't be confidently applied.
 */
export function evaluateIfGuard(
  rule: string,
  engineToolName: string,
  toolInput: unknown,
  /** The tool's other names (an MCP tool's `mcp__…`), matched as the hook matcher matches them. */
  aliases?: readonly string[],
  /** The hook's working directory: relative paths resolve, and rules anchor, here. */
  cwd?: string,
): boolean {
  const parsed = parseRuleString(rule)
  if (!parsed) return true // unparseable rule → fail open
  // Tool part must match this call's tool (CC↔engine aware); hooks.md: "Use the same scoped
  // tool name in a handler's `if` field" — a plugin MCP tool's `mcp__plugin_<p>_<s>__<t>`.
  if (!matchesToolName(parsed.tool, engineToolName, aliases, toolInput)) return false
  if (specifierIsAll(parsed.specifier)) return true
  const specifier = parsed.specifier!
  const tool = { name: engineToolName, ...(aliases ? { aliases } : {}) }
  const call = claudeCodeHookCall(tool, toolInput, cwd)
  const view = (call.tool_input ?? {}) as Record<string, unknown>
  const name = call.tool_name

  const param = paramMatches(specifier, view)
  if (param !== undefined) return param

  // Bash family: the specifier constrains every command of the call (a batch's too).
  if (name === 'Bash' || parsed.tool.trim().toLowerCase() === 'bash') {
    const command = stringField(view, 'command') ?? stringField(toolInput, 'command')
    if (command === undefined) return true // no command to test → fail open
    const subs = splitCompoundCommand(command)
    if (subs === null) return true // substitution present → fail open
    return subs.some((s) => matchBashSpecifier(specifier, s))
  }
  if (name === 'WebFetch') {
    const url = stringField(view, 'url')
    if (url === undefined || !specifier.trim().startsWith('domain:')) return true
    return ccDomainRuleMatches(specifier, url)
  }
  if (name === 'Agent')
    return specifierMatchesValue(specifier, stringField(view, 'subagent_type') ?? '')
  if (name === 'Skill') return specifierMatchesValue(specifier, stringField(view, 'skill') ?? '')

  // File tools: match any file of the call — a batched `edit`/`write` (`edits[].path`,
  // `files[].path`) or a batched `read` (a hook guarding `Read(*.env)` must still run when the
  // .env is the third entry) — anchored as permissions.md anchors a path rule.
  const base = baseOf(toolInput, cwd)
  const files = callPaths(toolInput, view, base)
  if (files.length > 0) {
    if (!cwd) return files.some((file) => fileSpecifierMatchesValue(specifier, file))
    return files.some((file) => ccPathRuleMatches(specifier, file, { cwd: base ?? cwd }))
  }
  const field = firstStringValue(view)
  if (field === undefined) return true // nothing to test → fail open
  return fileSpecifierMatchesValue(specifier, field)
}

/** The directory a call's relative paths resolve against: its own `cwd` below the hook's. */
function baseOf(input: unknown, cwd?: string): string | undefined {
  const own = stringField(input, 'cwd')
  if (!cwd) return own && isAbsolute(own) ? own : undefined
  return own ? resolve(cwd, own) : cwd
}

/** `file_path`, `path` and every `reads[].path` (a batched read) of a tool input. */
function filePathFields(input: unknown): string[] {
  const single = stringField(input, 'file_path') ?? stringField(input, 'path')
  const out = single === undefined ? [] : [single]
  const reads =
    input && typeof input === 'object' ? (input as { reads?: unknown }).reads : undefined
  if (Array.isArray(reads)) {
    for (const entry of reads) {
      const path = typeof entry === 'string' ? entry : stringField(entry, 'path')
      if (path !== undefined) out.push(path)
    }
  }
  return out
}
