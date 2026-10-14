import type {
  AgentTool,
  AgentToolResult,
  BeforeToolCallResult,
  AgentEvent,
} from '@localixai/agent/agents'
import type { AgentRuntimeRunInput } from '@localixai/agent/runtime'

import { toPiTool } from './tool-bridge'
import { applyAfterToolCall, applyBeforeToolCall } from './tool-call-hooks'

/** Activated schemas can only reveal implementations already authorized for this run. */
export function revealActivatedModelTools<T>(options: {
  activator: AgentTool | undefined
  result: AgentToolResult | undefined
  dispatchToolsByName: ReadonlyMap<string, AgentTool>
  modelToolNames: Set<string>
  modelTools: T[]
  toModelTool: (tool: AgentTool) => T
}): string[] {
  const result = options.result
  if (!options.activator?.activatesTools || !result || result.isError) return []
  const activated = (result.details as { activated?: unknown } | undefined)?.activated
  if (!Array.isArray(activated)) return []
  const revealed: string[] = []
  for (const rawName of activated) {
    if (typeof rawName !== 'string' || options.modelToolNames.has(rawName)) continue
    const tool = options.dispatchToolsByName.get(rawName)
    if (!tool) continue
    options.modelToolNames.add(rawName)
    options.modelTools.push(options.toModelTool(tool))
    revealed.push(rawName)
  }
  return revealed
}

/** One run owns its dispatch registry, visible schemas, results and permission decisions. */
export function createRunTools(
  input: AgentRuntimeRunInput,
  signal: AbortSignal,
  push: (event: AgentEvent) => Promise<void>,
) {
  const dispatch = input.dispatchTools ?? input.tools
  const completedTools = new Map<string, AgentToolResult>()
  const gateDecisions = new Map<string, BeforeToolCallResult>()
  const toolsByName = new Map(dispatch.map((tool) => [tool.name, tool]))
  const tools = dispatch.map((tool) =>
    toPiTool(tool, input.toolExecutionContext, completedTools, push),
  )
  const toModelTool = (tool: AgentTool) =>
    toPiTool(tool, input.toolExecutionContext, completedTools, push, {
      modelSchema: true,
      onSchemaCompacted: (diagnostic) => {
        console.warn(
          `[agent-runtime-pi] tool_schema_compacted tool=${tool.name} reason=${diagnostic.reason} original_bytes=${diagnostic.originalBytes} final_bytes=${diagnostic.finalBytes} budget_bytes=${diagnostic.budgetBytes} stages=${diagnostic.stages.join(',')}`,
        )
      },
    })
  const modelTools = input.tools.map(toModelTool)
  const modelToolNames = new Set(input.tools.map((tool) => tool.name))

  return {
    tools,
    modelTools,
    completedTools,
    settled: (toolCallId: string) => gateDecisions.delete(toolCallId),
    beforeToolCall: ({
      toolCall,
      args,
    }: {
      toolCall: { id: string; name: string }
      args: unknown
    }) =>
      applyBeforeToolCall({
        tool: toolsByName.get(toolCall.name),
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        args,
        signal,
        beforeToolCall: input.beforeToolCall,
        completedTools,
        gateDecisions,
      }),
    afterToolCall: async ({
      toolCall,
      args,
      result,
      isError,
    }: {
      toolCall: { id: string; name: string }
      args: unknown
      result: Parameters<typeof applyAfterToolCall>[0]['result']
      isError: boolean
    }) => {
      const patch = await applyAfterToolCall({
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        args,
        result,
        isError,
        signal,
        afterToolCall: input.afterToolCall,
        completedTools,
        gateDecisions,
      })
      revealActivatedModelTools({
        activator: toolsByName.get(toolCall.name),
        result: completedTools.get(toolCall.id),
        dispatchToolsByName: toolsByName,
        modelToolNames,
        modelTools,
        toModelTool,
      })
      return patch
    },
  }
}
