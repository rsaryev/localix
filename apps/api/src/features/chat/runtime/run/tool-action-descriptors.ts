import type { ToolAction, ToolActionDescriptor } from '@localixai/agent/agents'

/** Strip executable callbacks before live actions cross the server/UI boundary. */
export function describeToolActions(
  toolCallId: string,
  actions: Record<string, ToolAction> | undefined,
): ToolActionDescriptor[] | undefined {
  if (!actions) return undefined
  return Object.entries(actions).map(([action, descriptor]) => ({
    toolCallId,
    action,
    label: descriptor.label,
    icon: descriptor.icon,
    enabled: descriptor.enabled,
    tone: descriptor.tone,
  }))
}
