import type { AgentItem } from '@localixai/agent/agents'

export interface TranscriptTurn {
  readonly role: 'user' | 'assistant'
  readonly items: readonly AgentItem[]
}
