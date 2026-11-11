import {
  availableTools,
  bashFileTargets,
  evaluateRules,
  parseRule,
  prepareCall,
  resolveRuleDirectories,
  type PathContext,
  type PermissionRule,
  type RuleSource,
  type ToolCall,
} from '@rsaryev/llx-plugin/rules'
import type { PolicyScope } from '@rsaryev/llx-plugin/settings'
import { singleCalls } from './tools/cc-tool-shapes'
import { claudeCodeHookCall } from './tool-calls'
import { claudeCodeToolNames, LOCALIX_TOOL_NAMES, type NamedTool } from './tool-names'
import { realPathResolver } from './ports/session-files'
import type { SettingsRuleEntry } from './settings/permissions'

/**
 * CLAUDE CODE'S PERMISSION RULES AT A LOCALIX CALL. The kit reads each rule in force
 * (`parseRule`) and judges a call against them (`evaluateRules`: deny, then ask, then allow,
 * whatever the order of files and rules; `bashFileTargets` for the files a shell line names;
 * `availableTools` for the bare denials that take a tool away; `prepareCall` and
 * `resolveRuleDirectories` for where a symlink leads). This file only puts a Localix call in
 * Claude Code's shape (`tool-calls.ts`) and says where a rule was written.
 */
export interface SettingsRules {
  readonly rules: readonly PermissionRule[]
  readonly paths: PathContext
  /** Where each rule was written (a settings file, a skill's `allowed-tools`), and its refusal. */
  readonly origins: ReadonlyMap<PermissionRule, RuleOrigin>
}

/** `where`: the settings file, or what added the rule for the run. */
export interface RuleOrigin {
  readonly where: string
  readonly message?: string
}

export interface SettingsVerdict extends RuleOrigin {
  effect: 'allow' | 'ask' | 'deny'
  /** As written: `Bash(rm *)`. */
  rule: string
}

/** Rules a run adds beside the settings: a skill's or command's tool lists, an agent's denials. */
export interface SessionRuleSpec {
  readonly rules: readonly string[]
  readonly behavior: 'allow' | 'deny'
  readonly where: string
  readonly message?: string
}

/** Per Claude Code call of a Localix call, in order: where its path really is, when a link. */
export type ResolvedPaths = readonly (readonly string[] | undefined)[]

type RunPaths = { cwd: string; homeDir: string; additionalDirectories: readonly string[] }

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

export function settingsRules(entries: readonly SettingsRuleEntry[], at: RunPaths): SettingsRules {
  const origins = new Map<PermissionRule, RuleOrigin>()
  for (const entry of entries) {
    const source = SOURCE_OF[entry.scope](entry.file)
    const rule = source && parseRule(entry.raw, { behavior: entry.effect, source }).rule
    if (rule) origins.set(rule, { where: entry.file })
  }
  const paths: PathContext = {
    cwd: at.cwd,
    home: at.homeDir,
    primaryWorkingDirectory: at.cwd,
    additionalDirectories: at.additionalDirectories,
    platform: 'posix',
  }
  return { rules: [...origins.keys()], paths, origins }
}

/**
 * The rules with a run's own added, read as Claude Code reads `--allowedTools` and
 * `--disallowedTools` entries (source `session`: a `/path` anchors at the working directory).
 */
export function withSessionRules(base: SettingsRules, specs: SessionRuleSpec): SettingsRules {
  const origins = new Map(base.origins)
  const source = { kind: 'session' } as const
  for (const text of specs.rules) {
    const rule = parseRule(text, { behavior: specs.behavior, source }).rule
    const message = specs.message ? { message: specs.message } : {}
    if (rule) origins.set(rule, { where: specs.where, ...message })
  }
  return { ...base, rules: [...origins.keys()], origins }
}

/**
 * One Localix call as the calls Claude Code's tools would make (`own`), and the files a shell line
 * names, as the `Read` and `Edit` rules see them (`files`).
 */
function claudeCodeCalls(tool: NamedTool, input: unknown, paths: PathContext) {
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
 * Where the paths of a call really are (permissions.md, "Symlinks": the check covers the path
 * requested and the file it resolves to). A path the resolver cannot follow (a loop) is judged as
 * requested: the tool itself refuses it.
 */
export async function settingsResolvedPaths(
  rules: SettingsRules,
  tool: NamedTool,
  input: unknown,
  signal?: AbortSignal,
): Promise<ResolvedPaths> {
  const { own, files } = claudeCodeCalls(tool, input, rules.paths)
  return Promise.all(
    [...own, ...files].map(async (call) => {
      const prepared = await prepareCall(call, rules.paths, realPathResolver, { signal })
      return 'resolvedPaths' in prepared ? prepared.resolvedPaths : undefined
    }),
  )
}

/** The rules with the real location of each linked directory a deny or ask rule names. */
export async function withRealDirectories(rules: SettingsRules): Promise<SettingsRules> {
  const real = await resolveRuleDirectories(rules.rules, rules.paths, realPathResolver)
  return real.size ? { ...rules, paths: { ...rules.paths, realDirectories: real } } : rules
}

/**
 * What the rules say about a call: a deny anywhere beats an ask anywhere, which beats an allow; an
 * allow holds when it covers each of the call's own calls (a shell line's files only restrict).
 */
export function settingsVerdict(
  rules: SettingsRules,
  tool: NamedTool,
  input: unknown,
  resolved?: ResolvedPaths,
): SettingsVerdict | undefined {
  const judge = (call: ToolCall, at: number) => {
    const resolvedPaths = resolved?.[at]
    const prepared = resolvedPaths ? { ...call, resolvedPaths } : call
    return evaluateRules(rules.rules, prepared, { paths: rules.paths })
  }
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
  return { effect: decided.effect, rule: decided.rule.text, ...rules.origins.get(decided.rule)! }
}

/**
 * Whether bare deny rules take the tool away (`availableTools` over Localix's names: a tool goes
 * when any of its Claude Code names is removed). An MCP tool goes by its `mcp__<server>__<tool>`
 * address, which the names leave as it is; `--tools` lists the tool's own names, so no built-in
 * default (Glob and Grep absent on posix) removes it.
 */
export function settingsRemovesTool(rules: SettingsRules, tool: NamedTool): boolean {
  const session = {
    platform: 'posix' as const,
    rules: rules.rules,
    toolsFlag: claudeCodeToolNames(tool),
    names: LOCALIX_TOOL_NAMES,
  }
  return availableTools([tool.aliases?.[0] ?? tool.name], session).length === 0
}

/** Whether an `Agent(<type>)` deny rule keeps a subagent type from the model. */
export function settingsDeniesAgent(rules: SettingsRules, agentType: string): boolean {
  const call = { toolName: 'Agent', input: { subagent_type: agentType } }
  return evaluateRules(rules.rules, call, { paths: rules.paths }).behavior === 'deny'
}
