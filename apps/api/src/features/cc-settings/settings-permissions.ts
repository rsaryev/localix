import { TOOL } from '../agent-core/tool-names'
import { isRecord } from '../../lib/record'
import type { PermissionRule } from '../agent-core/permission-engine'
import { claudeCodeAllowRules } from './cc-rule-translate'
import { normalizeCcToolName } from '../ext/cc-tool-names'
import { parseRuleString } from './permission-rules'
import { specifierIsAll, specifierMatchesValue } from './permission-value-match'
import { bashRuleMatches } from './settings-bash-match'
import { pathListMatches } from './settings-path-match'
import { fetchedUrls, webFetchRuleMatches } from './settings-webfetch-match'

/**
 * CLAUDE CODE'S PERMISSION RULES, judged as Claude Code judges them (permissions.md, "Permission
 * rule syntax", "Tool-specific permission rules", "Settings precedence"): every `allow`, `ask` and
 * `deny` rule in force counts, and a deny anywhere beats an ask anywhere, which beats an allow —
 * the order of the files and of the rules does not matter. Localix's own rules are a separate,
 * ordered list; the gate combines the two (`agent-core/permission-verdict.ts`).
 *
 * Which rules are in force — trust, `allowManagedPermissionRulesOnly` — the kit decides
 * (`settingsRuleEntries` of `plugins/kit`); this file parses each entry once and matches calls.
 */

export type CcEffect = 'allow' | 'ask' | 'deny'

/** A rule in force as the settings reader hands it: as written, with its file and anchor. */
export interface CcRuleEntry {
  effect: CcEffect
  raw: string
  file: string
  sourceDir: string
}

export interface CcPermissionRule extends CcRuleEntry {
  tool: string
  specifier?: string
}

/** One call, as the rules read it: Localix's tool and input, and what Localix resolved. */
export interface CcCallFacts {
  toolName: string
  /** The tool's Claude Code names (an MCP tool's `mcp__<server>__<tool>`). */
  aliases?: readonly string[]
  input: unknown
  /** Absolute paths the call reads or writes; `writes` the subset it writes. */
  paths: readonly string[]
  writes: readonly string[]
  commands?: readonly string[]
  cwd: string
  homeDir: string
}

/** The entries parsed; one that is no rule, or an `mcp__` rule with parentheses, is skipped as Claude Code skips it. */
export function settingsPermissionRules(entries: readonly CcRuleEntry[]): CcPermissionRule[] {
  return entries.flatMap((entry) => {
    const parsed = parseRuleString(entry.raw)
    if (!parsed) return []
    if (parsed.tool.startsWith('mcp__') && parsed.specifier !== undefined) return []
    const specifier = specifierIsAll(parsed.specifier) ? {} : { specifier: parsed.specifier }
    return [{ ...entry, tool: parsed.tool, ...specifier }]
  })
}

const READ_TOOLS = new Set<string>([TOOL.Read, TOOL.Search])
const EDIT_TOOLS = new Set<string>([TOOL.Edit, TOOL.Write])
/** A Bash parameter a rule can name (`Bash(run_in_background:true)`); `ls:*` is a prefix. */
const BASH_PARAMS = /^(run_in_background|timeout|description|dangerouslyDisableSandbox)\s*:\s*(.*)$/
const PARAM = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/
const PRIMARY_FIELDS = new Set(['command', 'file_path', 'path', 'notebook_path', 'url'])

const globMatch = (pattern: string, value: string) =>
  new RegExp(
    `^${pattern
      .split('*')
      .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  ).test(value)

/** Does the rule's tool name cover this call's tool? */
function namesTool(rule: CcPermissionRule, call: CcCallFacts): boolean {
  const names = [call.toolName, ...(call.aliases ?? [])]
  if (rule.tool.includes('*')) {
    // An allow glob counts only after a literal `mcp__<server>__`.
    if (rule.effect === 'allow' && !/^mcp__[^*]+__/.test(rule.tool)) return false
    return names.some((name) => globMatch(rule.tool, name))
  }
  if (rule.tool.startsWith('mcp__')) {
    const server = rule.tool.split('__').length === 2
    return names.some((name) => name === rule.tool || (server && name.startsWith(`${rule.tool}__`)))
  }
  if (names.includes(rule.tool)) return true
  const local = normalizeCcToolName(rule.tool)
  // A path rule that restricts also guards the files a shell line names, and a Read denial
  // the files an edit or a write would touch.
  const guards = rule.specifier !== undefined && rule.effect !== 'allow'
  if (rule.tool === 'Read')
    return (
      READ_TOOLS.has(call.toolName) ||
      (guards && (EDIT_TOOLS.has(call.toolName) || call.toolName === 'Bash'))
    )
  if (rule.tool === 'Edit' || rule.tool === 'MultiEdit')
    return EDIT_TOOLS.has(call.toolName) || (guards && call.toolName === 'Bash')
  return local === call.toolName
}

function paramMatches(match: RegExpExecArray, input: unknown): boolean {
  const [, name, value] = match
  if (!isRecord(input) || PRIMARY_FIELDS.has(name!)) return false
  const actual = input[name!]
  if (actual === undefined || actual === null || typeof actual === 'object') return false
  return globMatch(value!.trim(), String(actual as string | number | boolean | bigint))
}

/** Does the rule's specifier cover this call? */
function coversCall(rule: CcPermissionRule, call: CcCallFacts): boolean {
  const spec = rule.specifier
  // Localix reads pages and searches with one tool: `WebFetch` is about the pages it reads,
  // `WebSearch` about its searches.
  if (rule.tool === 'WebFetch' && call.toolName === 'Research')
    if (spec === undefined) return fetchedUrls(call.input).length > 0
  if (rule.tool === 'WebSearch' && call.toolName === 'Research')
    return isRecord(call.input) && fetchedUrls(call.input).length === 0
  if (spec === undefined) return true
  const input = isRecord(call.input) ? call.input : {}
  const at = { cwd: call.cwd, homeDir: call.homeDir, sourceDir: rule.sourceDir }
  if (rule.tool === 'Bash' || rule.tool === 'PowerShell') {
    if (call.toolName !== 'Bash') return false
    const param = BASH_PARAMS.exec(spec)
    if (param) return rule.effect !== 'allow' && paramMatches(param, input)
    const commands = call.commands?.length
      ? call.commands
      : typeof input.command === 'string'
        ? [input.command]
        : []
    return commands.some((command) => bashRuleMatches(spec, command))
  }
  if (rule.tool === 'Read' || rule.tool === 'Edit' || rule.tool === 'MultiEdit') {
    // A Read rule guards every file a call touches; an Edit rule the files it writes, a shell
    // redirection or `tee` included.
    const relevant = rule.tool === 'Read' ? call.paths : call.writes
    if (relevant.length === 0) return false
    const hit = (path: string) => pathListMatches([spec], rule.effect, path, at) !== undefined
    return rule.effect === 'allow' ? relevant.every(hit) : relevant.some(hit)
  }
  if (rule.tool === 'WebFetch') return webFetchRuleMatches(spec, input, rule.effect)
  const param = PARAM.exec(spec)
  if (param && rule.effect !== 'allow' && paramMatches(param, input)) return true
  if (rule.tool === 'Agent' || rule.tool === 'Task') {
    // A call with no `subagent_type` runs `general-purpose`, which also answers to `claude`.
    const type = input.subagent_type
    const named = typeof type === 'string' && type.trim() ? type.trim() : null
    const types =
      named === null || named.toLowerCase() === 'claude'
        ? [named ?? 'general-purpose', 'general-purpose']
        : [named]
    return types.some((type) => specifierMatchesValue(spec, type))
  }
  if (rule.tool === 'Skill') {
    const name = input.skill ?? input.name
    return typeof name === 'string' && specifierMatchesValue(spec, name)
  }
  return false
}

/** Path rules carry `!` carve-outs within their own file and list. */
function carvedOut(rule: CcPermissionRule, rules: readonly CcPermissionRule[], call: CcCallFacts) {
  if (rule.tool !== 'Read' && rule.tool !== 'Edit' && rule.tool !== 'MultiEdit') return false
  const siblings = rules.filter(
    (r) => r.file === rule.file && r.effect === rule.effect && r.tool === rule.tool && r.specifier,
  )
  if (!siblings.some((r) => r.specifier!.startsWith('!'))) return false
  const at = { cwd: call.cwd, homeDir: call.homeDir, sourceDir: rule.sourceDir }
  const targets = rule.tool === 'Read' ? call.paths : call.writes
  const specs = siblings.map((r) => r.specifier!)
  return targets.every((path) => pathListMatches(specs, rule.effect, path, at) === undefined)
}

/**
 * What Claude Code's restrictive rules say about a call: deny over ask; undefined if neither
 * names it. Allow rules are not judged here: they become the Localix rows that pre-approve the
 * same calls (`settingsAllowRows`, through `cc-rule-translate.ts`), which answer the agent's
 * catch-all question as a skill's `allowed-tools` do — and an ask or deny still wins over them.
 */
export function settingsPermissionDecision(
  rules: readonly CcPermissionRule[],
  call: CcCallFacts,
): { effect: 'ask' | 'deny'; rule: CcPermissionRule } | undefined {
  for (const effect of ['deny', 'ask'] as const) {
    const rule = rules.find(
      (r) =>
        r.effect === effect &&
        !r.specifier?.startsWith('!') &&
        namesTool(r, call) &&
        coversCall(r, call) &&
        !carvedOut(r, rules, call),
    )
    if (rule) return { effect, rule }
  }
  return undefined
}

/** Whether a bare deny rule (`WebFetch`, `mcp__github`, `mcp__*`) takes the tool away. */
export function settingsRemoveTool(
  rules: readonly CcPermissionRule[],
  tool: { name: string; aliases?: readonly string[] },
): boolean {
  const call = {
    toolName: tool.name,
    aliases: tool.aliases ?? [],
    input: {},
    paths: [],
    writes: [],
    cwd: '/',
    homeDir: '/',
  }
  return rules.some(
    (r) =>
      r.effect === 'deny' &&
      r.specifier === undefined &&
      r.tool !== 'WebFetch' &&
      r.tool !== 'WebSearch' &&
      namesTool(r, call),
  )
}

/** The allow rules as the Localix rows that pre-approve the same calls, anchored for `cwd`. */
export function settingsAllowRows(
  rules: readonly CcPermissionRule[],
  cwd: string,
): PermissionRule[] {
  return rules
    .filter((rule) => rule.effect === 'allow')
    .flatMap((rule) => claudeCodeAllowRules(rule.raw, cwd, rule.sourceDir))
}
