/**
 * WHAT A USER MAY DO TO AN AGENT — a shared leaf.
 *
 * Exported as `@localixai/api/agent-policy` and imported by the UI, so everything this module
 * VALUE-imports ships to the browser: nothing here throws or reaches `lib/errors`. The one rule is
 * the entry's own: a file the person owns is edited, deleted and copied; anything else is read-only
 * and copied to Yours (`editable`, set from the entry's source in `projection.ts`).
 */
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import type { AgentSummary } from './contracts'

export type AgentField =
  | 'name'
  | 'description'
  | 'prompt'
  | 'leadershipPriority'
  | 'model'
  | 'maxTurns'
  | 'context'

export interface AgentPolicy {
  editable: readonly AgentField[]
  disable: boolean
  delete: boolean
  duplicate: boolean
  capabilities: boolean
}

const FIELDS: readonly AgentField[] = [
  'name',
  'description',
  'prompt',
  'leadershipPriority',
  'model',
  'maxTurns',
  'context',
]

export function agentPolicy(summary: Pick<AgentSummary, 'record' | 'editable'>): AgentPolicy {
  return {
    editable: summary.editable ? FIELDS : [],
    // The main loop is what the app runs on.
    disable: summary.record.id !== DEFAULT_AGENT_ID,
    delete: summary.editable,
    duplicate: true,
    capabilities: true,
  }
}

export const canEditField = (policy: AgentPolicy, field: AgentField): boolean =>
  policy.editable.includes(field)

/**
 * May this agent take part in a conversation? Enabled, and its own policy allows the chat
 * invocation.
 *
 * One answer for the four places that ask it — the agent directory the model reads, the
 * composer's "add participant" menu, the sidebar and the breadcrumb — which used to spell it
 * separately and could disagree about who is invitable.
 */
export const canJoinConversation = (
  agent: Pick<AgentSummary, 'enabled' | 'invocations'>,
): boolean => agent.enabled && agent.invocations.chat === 'allow'
