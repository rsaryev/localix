import {
  availableTools,
  bashFileTargets,
  evaluateRules,
  parseRule,
  type PathContext,
  type PermissionRule,
  type RuleSource,
  type ToolCall,
} from '@rsaryev/llx-plugin/rules'
import type { PolicyScope } from '@rsaryev/llx-plugin/settings'
import {
  claudeCodeHookCall,
  claudeCodeNames,
  claudeCodeToolName,
  singleCalls,
} from '../../ext/cc-tool-shapes'
import type { SettingsRuleEntry } from './settings/permissions'

/**
 * CLAUDE CODE'S PERMISSION RULES AT A LOCALIX CALL. The kit reads each rule in force
 * (`parseRule`) and judges a call against them (`evaluateRules`: deny, then ask, then allow,
 * whatever the order of files and rules; `bashFileTargets` for the files a shell line names;
 * `availableTools` for the bare denials that take a tool away). This file only puts a Localix
 * call in Claude Code's shape (`ext/cc-tool-shapes.ts`) and says where a rule was written.
 */
export interface SettingsRules {
  readonly rules: readonly PermissionRule[]
  readonly paths: PathContext
  /** The settings file each rule came from, for a message that names it. */
  readonly files: ReadonlyMap<PermissionRule, string>
}

export interface SettingsVerdict {
  effect: 'allow' | 'ask' | 'deny'
  /** As written: `Bash(rm *)`. */
  rule: string
  file: string
}

type LocalTool = { readonly name: string; readonly aliases?: readonly string[] }

/** Where each settings scope's rules were written, in the rules module's terms. */
const SOURCE_OF: { readonly [S in PolicyScope]: (file: string) => RuleSource | undefined } = {
  managed: () => ({ kind: 'managed' }),
  parent: () => ({ kind: 'embedder-managed' }),
  flag: (file) => ({ kind: 'flag-settings', file }),
  local: () => ({ kind: 'local' }),
  project: () => ({ kind: 'project' }),
  user: () => ({ kind: 'user' }),
  addDir: () => undefined,
}

export function settingsRules(
  entries: readonly SettingsRuleEntry[],
  at: { cwd: string; homeDir: string; additionalDirectories: readonly string[] },
): SettingsRules {
  const files = new Map<PermissionRule, string>()
  for (const entry of entries) {
    const source = SOURCE_OF[entry.scope](entry.file)
    const rule = source && parseRule(entry.raw, { behavior: entry.effect, source }).rule
    if (rule) files.set(rule, entry.file)
  }
  const paths: PathContext = {
    cwd: at.cwd,
    home: at.homeDir,
    primaryWorkingDirectory: at.cwd,
    additionalDirectories: at.additionalDirectories,
    platform: 'posix',
  }
  return { rules: [...files.keys()], paths, files }
}

/**
 * One Localix call as the calls Claude Code's tools would make (`own`), and the files a shell line
 * names, as the `Read` and `Edit` rules see them (`files`).
 */
function claudeCodeCalls(tool: LocalTool, input: unknown, paths: PathContext) {
  const own: ToolCall[] = []
  const files: ToolCall[] = []
  for (const one of singleCalls(tool.name, input)) {
    const { tool_name, tool_input } = claudeCodeHookCall(tool, one, paths.cwd)
    own.push({ toolName: tool_name, input: tool_input })
    const command = (tool_input as { command?: unknown } | undefined)?.command
    if (tool_name !== 'Bash' || typeof command !== 'string') continue
    const targets = bashFileTargets(command, paths)
    const as = (toolName: string) => (file_path: string) => ({ toolName, input: { file_path } })
    files.push(...targets.reads.map(as('Read')), ...targets.writes.map(as('Edit')))
  }
  return { own, files }
}

/**
 * What the rules say about a call: a deny anywhere beats an ask anywhere, which beats an allow; an
 * allow holds when it covers each of the call's own calls (a shell line's files only restrict).
 */
export function settingsVerdict(
  rules: SettingsRules,
  tool: LocalTool,
  input: unknown,
): SettingsVerdict | undefined {
  const judge = (call: ToolCall) => evaluateRules(rules.rules, call, { paths: rules.paths })
  const { own, files } = claudeCodeCalls(tool, input, rules.paths)
  const verdicts = [...own, ...files].map(judge)
  const allowed = verdicts.slice(0, own.length)
  const found = (['deny', 'ask'] as const)
    .map((effect) => ({ effect, rule: verdicts.find((v) => v.behavior === effect)?.rule }))
    .find((one) => one.rule)
  const decided =
    found ??
    (allowed.length > 0 && allowed.every((v) => v.behavior === 'allow')
      ? { effect: 'allow' as const, rule: allowed[0]!.rule }
      : undefined)
  if (!decided?.rule) return undefined
  return {
    effect: decided.effect,
    rule: decided.rule.text,
    file: rules.files.get(decided.rule) ?? '',
  }
}

/** Whether bare deny rules take every Claude Code name of the tool away (`WebFetch`, `mcp__*`). */
export function settingsRemovesTool(rules: SettingsRules, tool: LocalTool): boolean {
  const shaped = claudeCodeNames(tool.name)
  const names = shaped.length > 0 ? shaped : [claudeCodeToolName(tool)]
  const session = { platform: 'posix' as const, rules: rules.rules, toolsFlag: names }
  return availableTools(names, session).length === 0
}

/** Whether an `Agent(<type>)` deny rule keeps a subagent type from the model. */
export function settingsDeniesAgent(rules: SettingsRules, agentType: string): boolean {
  const call = { toolName: 'Agent', input: { subagent_type: agentType } }
  return evaluateRules(rules.rules, call, { paths: rules.paths }).behavior === 'deny'
}
