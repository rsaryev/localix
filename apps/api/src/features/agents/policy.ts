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

export type AgentField = 'name' | 'description' | 'prompt' | 'model' | 'maxTurns' | 'context'

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
