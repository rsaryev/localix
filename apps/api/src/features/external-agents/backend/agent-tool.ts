import type { AgentTool } from '@localixai/agent/agents'
import { BUILTIN_TOOL_CATALOG } from '../../agent-core/tool-names'
import { externalAgentInputSchema, agentSessionsInput } from './agent-tool-schema'
import { runAgentSessions } from './tools/agent-sessions-tool'
import type { AgentSessionsService } from './service'

export function createExternalAgentSessionsTool(
  service: AgentSessionsService,
  ready: Promise<void>,
  sessionId: string,
): AgentTool {
  return {
    ...BUILTIN_TOOL_CATALOG.external_agent_sessions,
    activeVerb: 'Inspecting agent sessions',
    inputSchema: externalAgentInputSchema,
    executionMode: 'sequential',
    mutates: false,
    async execute(_toolCallId, input, signal) {
      await ready
      const parsed = externalAgentInputSchema.safeParse(input)
      if (!parsed.success)
        return { content: 'Invalid external agent session request.', isError: true }
      return runAgentSessions(service, agentSessionsInput(parsed.data), signal, sessionId)
    },
  }
}
