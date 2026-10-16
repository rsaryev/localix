import type { AgentTool } from '@localixai/agent/agents'
import type { PermissionRule } from '../../../agent-core/permission-engine'
import {
  assertRequiredToolsAvailable,
  type ToolRequirement,
} from '../../../agent-core/required-tools'
import { TOOL } from '../../../agent-core/tool-names'

/** Every turn can receive elided history, including retries and host-initiated wakes. */
export function assertRunToolRequirements(
  tools: readonly AgentTool[],
  rules: readonly PermissionRule[],
  hostRequirements?: readonly ToolRequirement[],
  /** Whether a prompt from this run would reach a person — see `hitl-reachable.ts`. */
  interactive = false,
): void {
  assertRequiredToolsAvailable(
    [{ name: TOOL.tool_output, resources: ['get'] }, ...(hostRequirements ?? [])],
    tools,
    rules,
    interactive,
  )
  // A compatibility restriction can leave the descriptor registered with search only.
  // Validate the recovery call's shape without reading storage or executing the tool.
  const recovery = tools.find((tool) => tool.name === TOOL.tool_output)!
  if (!recovery.inputSchema.safeParse({ action: 'get', tool_call_id: 'preflight' }).success) {
    throw new Error('Required run operation tool_output(get) is unavailable')
  }
}
