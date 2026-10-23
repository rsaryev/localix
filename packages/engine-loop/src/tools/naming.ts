/**
 * THE NAMES A TOOL HAS ON THE WIRE, and the one it has everywhere else.
 *
 * A tool may be offered to the model under a `modelName` (an MCP tool under the name another agent
 * gives it). The model then calls it by that name, so the loop translates at its two edges: a call
 * the model makes is renamed to the tool's own name before anything sees it — an event, the
 * transcript, the gate, a hook — and the history sent on the next request is renamed back. Inside
 * the run, a tool has one name.
 */
import type { AssistantMessage, Message } from '@localixai/agent'
import type { AgentMessageDelta, AgentTool } from '@localixai/agent/agents'

export interface ToolNaming {
  /** The tool's own name for a name the model used: its own name, or its model name. */
  internal(name: string): string
  /** The name the model knows a tool by. */
  wire(name: string): string
  /** A streamed delta with its call under the tool's own name. */
  delta(delta: AgentMessageDelta): AgentMessageDelta
  /** A response with every call under the tool's own name. */
  inbound(message: AssistantMessage): AssistantMessage
  /** History as the model reads it: calls and results under the names it was offered. */
  outbound(messages: Message[]): Message[]
}

const same = <T>(value: T): T => value

export function createToolNaming(tools: readonly AgentTool[]): ToolNaming {
  const toWire = new Map<string, string>()
  const toInternal = new Map<string, string>()
  const own = new Set(tools.map((tool) => tool.name))
  for (const { name, modelName } of tools) {
    if (!modelName || modelName === name || own.has(modelName)) continue
    toWire.set(name, modelName)
    toInternal.set(modelName, name)
  }
  if (toWire.size === 0)
    return { internal: same, wire: same, delta: same, inbound: same, outbound: same }

  const internal = (name: string) => (own.has(name) ? name : (toInternal.get(name) ?? name))
  const wire = (name: string) => toWire.get(name) ?? name
  const rename = <T extends { name: string }>(part: T, to: (name: string) => string): T => {
    const name = to(part.name)
    return name === part.name ? part : { ...part, name }
  }
  const calls = (message: AssistantMessage, to: (name: string) => string): AssistantMessage => {
    const content = message.content.map((part) =>
      part.type === 'tool_call' ? rename(part, to) : part,
    )
    return content.every((part, index) => part === message.content[index])
      ? message
      : { ...message, content }
  }

  return {
    internal,
    wire,
    delta: (delta) => (delta.kind === 'tool_call' ? rename(delta, internal) : delta),
    inbound: (message) => calls(message, internal),
    outbound: (messages) =>
      messages.map((message) => {
        if (message.role === 'assistant') return calls(message, wire)
        if (message.role !== 'tool') return message
        const results = message.results.map((result) => {
          const toolName = wire(result.toolName)
          return toolName === result.toolName ? result : { ...result, toolName }
        })
        const toolName = message.toolName === undefined ? undefined : wire(message.toolName)
        return results.every((result, index) => result === message.results[index]) &&
          toolName === message.toolName
          ? message
          : { ...message, results, ...(toolName === undefined ? {} : { toolName }) }
      }),
  }
}
