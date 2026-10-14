import type { AgentTool } from '@localixai/agent/agents'
import type { InstalledExternalAgent } from './installed'

export interface ExternalAgentsPort {
  toolFor(sessionId: string): AgentTool
  installed(): Promise<InstalledExternalAgent[]>
  observe(
    this: void,
    event: {
      toolName: string
      input: unknown
      result: { content: string; details?: unknown }
      sessionId: string
    },
  ): void
}
