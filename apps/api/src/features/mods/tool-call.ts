import { mcpInputSchema, type AgentTool, type AgentToolResult } from '@localixai/agent/agents'
import type { ModScene } from './contracts'
import type { ModsHost } from './host'

/**
 * `tool.call` in Localix. Every tool call of a conversation goes through the mods enabled there:
 * `e.tool` is Claude Code's name for the tool (`Bash`, `Read`, `mcp__<plugin>__<tool>`), its
 * arguments are fields of `e` (a path also as `file_path`, as Claude Code's file tools take it),
 * and `next(e)` runs the tool, resolving to `{ result, isError }`. A hook that answers `{ deny }`
 * refuses the call — the model reads the reason — and `{ result }` answers it in the tool's place.
 * A mod's own tools (`$.tool.register`) have no core behind them: a `tool.call` hook answers them.
 */

/** Localix's core tools under the names a mod matches them by. */
const CLAUDE_CODE_NAMES: Record<string, string> = {
  bash: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  search: 'Grep',
  ask: 'AskUserQuestion',
  research: 'WebFetch',
}

/** A mod's tool, named as Claude Code names it, characters outside `[A-Za-z0-9_-]` as `_`. */
export const modToolName = (plugin: string, name: string) =>
  `mcp__${plugin}__${name}`.replace(/[^A-Za-z0-9_-]/g, '_')

/** Refused by a mod's `tool.call` hook; the failure guard stamps it `blocked` by name. */
export class ModToolDeniedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'ModToolDeniedError'
  }
}

type Fields = Record<string, unknown>

function eventOf(tool: string, input: unknown, toolUseId: string): Fields {
  const fields: Fields = input && typeof input === 'object' ? { ...(input as Fields) } : {}
  if (typeof fields.path === 'string' && fields.file_path === undefined)
    fields.file_path = fields.path
  return { ...fields, tool: CLAUDE_CODE_NAMES[tool] ?? tool, tool_use_id: toolUseId }
}

/** The tool's input back from an event a hook may have rewritten. */
function inputOf(event: Fields, original: unknown): unknown {
  const { tool: _tool, tool_use_id: _id, ...fields } = event
  const had = original && typeof original === 'object' ? (original as Fields) : {}
  if (had.file_path === undefined && 'file_path' in fields) {
    if (fields.file_path !== had.path) fields.path = fields.file_path
    delete fields.file_path
  }
  return fields
}

/** What `next(e)` resolves to and what a hook may answer, as one tool result. */
function resultOf(answer: unknown, fallback: AgentToolResult): AgentToolResult {
  if (!answer || typeof answer !== 'object') return fallback
  const record = answer as { deny?: unknown; result?: unknown; isError?: unknown }
  if (typeof record.deny === 'string') throw new ModToolDeniedError(record.deny)
  if (record.result === undefined) return fallback
  if (record.result && typeof record.result === 'object' && 'content' in record.result)
    return record.result as AgentToolResult
  const content =
    typeof record.result === 'string' ? record.result : JSON.stringify(record.result, null, 2)
  return { content, ...(record.isError === true ? { isError: true } : {}) }
}

export interface ModToolScope {
  host: ModsHost
  scene: ModScene
  /** The mods enabled where the call happens. */
  plugins: ReadonlySet<string>
}

/** Run each tool through `tool.call`; the same array when no enabled mod hooks it. */
export function wrapToolsWithMods(tools: readonly AgentTool[], scope: ModToolScope): AgentTool[] {
  if (!scope.host.hears('tool.call', scope.plugins)) return [...tools]
  return tools.map((tool) => ({
    ...tool,
    async execute(toolCallId, input, signal, onUpdate, context) {
      let ran: AgentToolResult = { content: '' }
      const answer = await scope.host.dispatch(
        'tool.call',
        eventOf(tool.name, input, toolCallId),
        async (event) => {
          ran = await tool.execute(
            toolCallId,
            inputOf(event as Fields, input),
            signal,
            onUpdate,
            context,
          )
          return { result: ran, ...(ran.isError ? { isError: true } : {}) }
        },
        scope.scene,
        scope.plugins,
      )
      return resultOf(answer, ran)
    },
  }))
}

/** The tools the enabled mods registered, each answered by their `tool.call` hooks. */
export function modTools(scope: ModToolScope): AgentTool[] {
  return scope.host.registry
    .tools()
    .filter((tool) => scope.plugins.has(tool.plugin))
    .map((spec) => {
      const name = modToolName(spec.plugin, spec.name)
      return {
        name,
        label: `${spec.plugin} · ${spec.name}`,
        description: spec.description,
        inputSchema: mcpInputSchema(spec.inputSchema ?? { type: 'object', properties: {} }),
        activeVerb: 'Running',
        async execute(toolCallId, input) {
          const unanswered: AgentToolResult = {
            content: `No hook of ${spec.plugin} answered ${name}`,
            isError: true,
          }
          const answer = await scope.host.dispatch(
            'tool.call',
            eventOf(name, input, toolCallId),
            () => ({ result: unanswered, isError: true }),
            scope.scene,
            scope.plugins,
          )
          return resultOf(answer, unanswered)
        },
      } satisfies AgentTool
    })
}
