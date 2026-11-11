import { toolNamesOf, type HostToolNames } from '@rsaryev/llx-plugin/rules'

/**
 * HOW LOCALIX'S TOOLS ARE NAMED IN CLAUDE CODE'S TERMS, stated once for the kit
 * (`HostToolNames`): every session (`sessions.ts`, `scope-session.ts`), a subagent's `tools` and
 * `disallowedTools` (`subagent-tools.ts`), a hook's `tool_name`, a permission rule and a mod's
 * `tool.call` read a Localix call by the Claude Code name these give. A tool left out is named
 * the same on both sides (`Read`, `Edit`, `Agent`, `Skill`, `Browser`).
 */

type Input = Readonly<Record<string, unknown>>

const isInput = (value: unknown): value is Input =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const LOOP_NAMES: Readonly<Record<string, string>> = {
  remove: 'CronDelete',
  list: 'CronList',
  reschedule: 'ScheduleWakeup',
}

/** The Claude Code name of one call, for the tools whose input decides it. */
const CALL_NAMES: Readonly<Record<string, (input: Input) => string>> = {
  // A `bash` call with `until` is the wait Claude Code's Monitor tool starts.
  Bash: (input) => (input.until !== undefined ? 'Monitor' : 'Bash'),
  // `search` with only a `glob` lists files, as Glob does; any query searches, as Grep does.
  Search: (input) =>
    input.query === undefined && input.queries === undefined && typeof input.glob === 'string'
      ? 'Glob'
      : 'Grep',
  // `research` with only URLs fetches pages, as WebFetch does.
  Research: (input) =>
    Array.isArray(input.urls) && input.urls.length > 0 && input.queries === undefined
      ? 'WebFetch'
      : 'WebSearch',
  // A call Claude Code has no tool for goes by the name the model calls it.
  Plan: (input) => (input.action === 'present' ? 'ExitPlanMode' : 'Plan'),
  Loops: (input) =>
    input.action === 'add'
      ? input.cron === undefined
        ? 'ScheduleWakeup'
        : 'CronCreate'
      : (LOOP_NAMES[String(input.action)] ?? 'Loops'),
  McpResources: (input) =>
    input.action === 'read' ? 'ReadMcpResourceTool' : 'ListMcpResourcesTool',
}

export const LOCALIX_TOOL_NAMES: HostToolNames = {
  toClaude: {
    Bash: ['Bash', 'Monitor'],
    Search: ['Grep', 'Glob'],
    Research: ['WebSearch', 'WebFetch'],
    Plan: ['Plan', 'ExitPlanMode'],
    Loops: ['Loops', 'CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup'],
    McpResources: ['ListMcpResourcesTool', 'ReadMcpResourceTool'],
  },
  callName: (tool, input) => (isInput(input) ? CALL_NAMES[tool]?.(input) : undefined),
}

/** `LOCALIX_TOOL_NAMES` read both ways. */
export const localixToolNames = toolNamesOf(LOCALIX_TOOL_NAMES)

/** A Localix tool as far as its name goes: an MCP tool carries its Claude Code address. */
export interface NamedTool {
  readonly name: string
  /** An MCP tool's `mcp__<server>__<tool>` (`agents/tool-definition.ts`). */
  readonly aliases?: readonly string[]
}

/** The Claude Code name of a call of the tool: an MCP tool's address, else the table's. */
export function claudeCodeToolName(tool: NamedTool, input?: unknown): string {
  return tool.aliases?.[0] ?? localixToolNames.claudeName(tool.name, input)
}

/** Every Claude Code name the tool answers to (`Search` is `Grep` and `Glob`). */
export function claudeCodeToolNames(tool: NamedTool): readonly string[] {
  return tool.aliases?.length ? [tool.aliases[0]!] : localixToolNames.claudeNames(tool.name)
}

/** Localix's tool for a name a hook or mod wrote as Claude Code does (`Grep` is `Search`). */
export function localToolName(name: string): string {
  return localixToolNames.hostNames(name)[0] ?? name
}
