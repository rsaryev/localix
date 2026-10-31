import { mcpInputSchema, type AgentTool, type AgentToolResult } from '@localixai/agent/agents'
import { isBlockedThrow } from '../agent-core/tools/tool-error-result'
import { singleCalls, toolCallEvent, toolInputOf } from '../ext/cc-tool-shapes'
import type { ModScene } from './contracts'
import { agentOf } from './event-scope'
import type { ModsHost } from './host'
import { coreAnswer, resultOf } from './tool-answers'
import { errorMessage } from '../../lib/errors'

/**
 * `tool.call` in Localix. Every tool call of a conversation goes through the mods enabled there:
 * `e.tool` is Claude Code's name for the tool (`Bash`, `Read`, `mcp__<plugin>__<tool>`), its
 * arguments are fields of `e` in Claude Code's shape (`tool-shapes.ts`, file paths absolute), and
 * `next(e)` runs the `PreToolUse` hooks, the permission check (`tool.check`, then the mode:
 * `chain-gate.ts` in the chat runtime) and the tool, resolving to Claude Code's
 * `{ result, text, ref }` (`tool-answers.ts`), or to `{ deny }` when a hook or the check refused
 * it. A hook that answers `{ deny }` refuses the call — the model reads the reason, and nobody is
 * asked — and `{ result }` answers it in the tool's place. A Localix call that edits or writes
 * several files is one `tool.call` per file, as Claude Code's single-file tools make them.
 * A mod's own tools (`$.tool.register`) have no core behind them: a `tool.call` hook answers them.
 */

/** A mod's tool, named as Claude Code names it, characters outside `[A-Za-z0-9_-]` as `_`. */
export const modToolName = (plugin: string, name: string) =>
  `mcp__${plugin}__${name}`.replace(/[^A-Za-z0-9_-]/g, '_')

/** The tools this run's mods registered. */
const scopedTools = (scope: ModToolScope) =>
  scope.host.registry.tools().filter((tool) => scope.plugins.has(tool.instance))

type Fields = Record<string, unknown>

export interface ModToolScope {
  host: ModsHost
  scene: ModScene
  /** The mod instances of the project where the call happens. */
  plugins: ReadonlySet<string>
  /** A delegated child's call: its session id (`agentId`). */
  agentId?: string
}

type Execute = AgentTool['execute']

/** One single-file call of `tool` through `tool.call`. */
async function callThrough(
  tool: AgentTool,
  scope: ModToolScope,
  args: Parameters<Execute>,
): Promise<AgentToolResult> {
  const [toolCallId, input, signal, onUpdate, context] = args
  const seen = toolCallEvent(tool, input, toolCallId, scope.scene.cwd)
  // A path the hooks left as they saw it goes to the tool as the call wrote it.
  const written = toolCallEvent(tool, input, toolCallId).file_path
  let ran: AgentToolResult = { content: '' }
  let refused = undefined as { error: unknown; reason: string } | undefined
  const answer = await scope.host.dispatch(
    'tool.call',
    { ...seen, ...agentOf(scope) },
    async (event) => {
      const fields = event as Fields
      const own =
        seen.file_path !== undefined && fields.file_path === seen.file_path
          ? { ...fields, file_path: written }
          : fields
      const local = toolInputOf(tool.name, own)
      try {
        ran = await tool.execute(toolCallId, local, signal, onUpdate, context)
      } catch (error) {
        // A `PreToolUse` hook or the permission check refused the call: `next(e)` resolves to
        // `{ deny }`, as in Claude Code, rather than throwing at the hook.
        if (!isBlockedThrow(error)) throw error
        refused = { error, reason: errorMessage(error) }
        return { deny: refused.reason }
      }
      return coreAnswer(tool, local, ran, scope.scene.cwd)
    },
    scope.scene,
    scope.plugins,
    undefined,
    signal,
  )
  // The refusal handed back as it came keeps its own shape (whose refusal, the sentence the
  // person sees); a mod's own `deny` is the mod's.
  const deny = (answer as { deny?: unknown } | undefined)?.deny
  if (refused && deny === refused.reason) throw refused.error
  return resultOf(answer, ran)
}

/** Run each tool through `tool.call`; the same array when no enabled mod hooks it. */
export function wrapInToolCall(tools: readonly AgentTool[], scope: ModToolScope): AgentTool[] {
  if (!scope.host.hears('tool.call', scope.plugins)) return [...tools]
  // A mod's own tool fires `tool.call` itself (`modTools`): wrapping it again would fire it twice.
  const own = new Set(scopedTools(scope).map((tool) => modToolName(tool.plugin, tool.name)))
  return tools.map((tool) =>
    own.has(tool.name)
      ? tool
      : {
          ...tool,
          async execute(toolCallId, input, ...rest) {
            const calls = singleCalls(tool.name, input)
            if (calls.length === 1) return callThrough(tool, scope, [toolCallId, input, ...rest])
            // One call per file, in order; the model reads their results together.
            const results: AgentToolResult[] = []
            for (const [index, single] of calls.entries())
              results.push(
                await callThrough(tool, scope, [
                  index === 0 ? toolCallId : `${toolCallId}:${index + 1}`,
                  single,
                  ...rest,
                ]),
              )
            return {
              content: results.map((result) => result.content).join('\n'),
              ...(results.some((result) => result.isError) ? { isError: true } : {}),
            }
          },
        },
  )
}

/** The tools the enabled mods registered, each answered by their `tool.call` hooks. */
export function modTools(scope: ModToolScope): AgentTool[] {
  return scopedTools(scope).map((spec) => {
    const name = modToolName(spec.plugin, spec.name)
    return {
      name,
      label: `${spec.plugin} · ${spec.name}`,
      description: spec.description,
      inputSchema: mcpInputSchema(spec.inputSchema ?? { type: 'object', properties: {} }),
      activeVerb: 'Running',
      async execute(toolCallId, input, signal) {
        const unanswered: AgentToolResult = {
          content: `No hook of ${spec.plugin} answered ${name}`,
          isError: true,
        }
        const answer = await scope.host.dispatch(
          'tool.call',
          { ...toolCallEvent({ name }, input, toolCallId), ...agentOf(scope) },
          () => ({ result: unanswered.content, text: unanswered.content, isError: true }),
          scope.scene,
          scope.plugins,
          undefined,
          signal,
        )
        return resultOf(answer, unanswered)
      },
    } satisfies AgentTool
  })
}
