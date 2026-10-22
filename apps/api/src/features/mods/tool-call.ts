import { mcpInputSchema, type AgentTool, type AgentToolResult } from '@localixai/agent/agents'
import type { ModScene } from './contracts'
import type { ModsHost } from './host'
import { toolCallEvent, toolInputOf } from './tool-shapes'

/**
 * `tool.call` in Localix. Every tool call of a conversation goes through the mods enabled there:
 * `e.tool` is Claude Code's name for the tool (`Bash`, `Read`, `mcp__<plugin>__<tool>`), its
 * arguments are fields of `e` in Claude Code's shape (`tool-shapes.ts`), and `next(e)` runs the tool, resolving to `{ result, isError }`. A hook that answers `{ deny }`
 * refuses the call — the model reads the reason — and `{ result }` answers it in the tool's place.
 * A mod's own tools (`$.tool.register`) have no core behind them: a `tool.call` hook answers them.
 */

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
  /** The mod instances of the project where the call happens. */
  plugins: ReadonlySet<string>
}

/** Run each tool through `tool.call`; the same array when no enabled mod hooks it. */
export function wrapInToolCall(tools: readonly AgentTool[], scope: ModToolScope): AgentTool[] {
  if (!scope.host.hears('tool.call', scope.plugins)) return [...tools]
  // A mod's own tool fires `tool.call` itself (`modTools`): wrapping it again would fire it twice.
  const own = new Set(
    scope.host.registry
      .tools()
      .filter((tool) => scope.plugins.has(tool.instance))
      .map((tool) => modToolName(tool.plugin, tool.name)),
  )
  return tools.map((tool) =>
    own.has(tool.name)
      ? tool
      : {
          ...tool,
          async execute(toolCallId, input, signal, onUpdate, context) {
            let ran: AgentToolResult = { content: '' }
            const answer = await scope.host.dispatch(
              'tool.call',
              toolCallEvent(tool, input, toolCallId),
              async (event) => {
                ran = await tool.execute(
                  toolCallId,
                  toolInputOf(tool.name, event as Fields),
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
        },
  )
}

/** The tools the enabled mods registered, each answered by their `tool.call` hooks. */
export function modTools(scope: ModToolScope): AgentTool[] {
  return scope.host.registry
    .tools()
    .filter((tool) => scope.plugins.has(tool.instance))
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
            toolCallEvent({ name }, input, toolCallId),
            () => ({ result: unanswered, isError: true }),
            scope.scene,
            scope.plugins,
          )
          return resultOf(answer, unanswered)
        },
      } satisfies AgentTool
    })
}
