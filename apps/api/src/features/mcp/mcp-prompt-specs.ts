import { mcpPromptCommandName, type McpServerPrompt } from './mcp-prompts'
import type { McpPromptSpec } from '../../contracts/capability-snapshot'

/** The snapshot's view of connected servers' prompts: each as the slash command that runs it. */
export function mcpPromptSpecs(prompts: readonly McpServerPrompt[]): McpPromptSpec[] {
  return prompts.map(({ server, prompt }) => ({
    server,
    name: prompt.name,
    fullName: mcpPromptCommandName(server, prompt.name),
    description: prompt.description ?? '',
    args: (prompt.arguments ?? []).map((arg) => ({
      name: arg.name,
      description: arg.description ?? '',
      required: arg.required === true,
    })),
  }))
}
