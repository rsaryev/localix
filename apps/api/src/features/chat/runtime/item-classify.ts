import type { CommandJobStatus, ToolBackedItem } from '@localixai/agent/agents'

/**
 * Which KIND of item a tool call becomes, and whether it carries a job.
 *
 * Both questions are asked once, before any of the type-specific building, and both are pure
 * — which is why they live apart from the builders that consume them.
 */

/** The job half of a tool-backed item: present exactly when the call handed off to one. */
export function jobFields(details: Record<string, unknown> | undefined): {
  isBackground?: true
  jobStatus?: CommandJobStatus
} {
  const status = typeof details?.jobStatus === 'string' ? details.jobStatus : undefined
  return {
    ...(details?.isBackground === true ? { isBackground: true as const } : {}),
    ...(status ? { jobStatus: status as CommandJobStatus } : {}),
  }
}

/** Map a tool name to its specialized item type, or `tool_call` for the rest. */
export function classifyTool(name: string): ToolBackedItem['type'] {
  switch (name) {
    case 'bash':
      return 'command'
    case 'write':
    case 'edit':
      return 'file_change'
    default:
      return name.startsWith('mcp__') || name.startsWith('mcp_') ? 'mcp_call' : 'tool_call'
  }
}
