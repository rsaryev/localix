/**
 * WHAT A USER MAY DO TO AN AGENT — a shared leaf.
 *
 * Exported as `@localixai/api/agent-policy` and imported by the settings screen, so everything
 * this module VALUE-imports ships to the browser. That is why nothing here throws and nothing
 * here reaches `lib/errors`: the refusal that applies this policy on the server lives in
 * `disable-guard.ts`. The browser-graph guard (`scripts/browser-graph-guard.test.ts`) proves the
 * leaf stays a leaf; the Vite config fails the dev server at the first `node:` import so the
 * lesson does not have to be relearned at render time.
 */
import { builtinAgentId } from '@localixai/agent/agents'
import type { AgentRecord, AgentSummary } from './contracts'
import { DEFAULT_AGENT_HANDLE } from '../../db/participant'

/** Registry ownership governs editing; it never grants execution authority. */
export type AgentField =
  | 'id'
  | 'name'
  | 'label'
  | 'description'
  | 'prompt'
  | 'leadershipPriority'
  | 'model'
  | 'maxTurns'
  | 'context'

export const FIELD_KEYS: Record<AgentField, readonly (keyof AgentRecord)[]> = {
  id: ['id'],
  name: ['handle'],
  label: ['label'],
  description: ['description'],
  prompt: ['instructions'],
  leadershipPriority: ['leadershipPriority'],
  model: ['modelPreference'],
  maxTurns: ['limits'],
  context: ['context'],
}

export interface AgentPolicy {
  editable: readonly AgentField[]
  disable: boolean
  delete: boolean
  duplicate: boolean
  capabilities: boolean
}

const EDITABLE: readonly AgentField[] = [
  'label',
  'description',
  'prompt',
  'leadershipPriority',
  'model',
  'maxTurns',
  'context',
]

export function agentPolicy(
  summary: Pick<AgentSummary, 'record' | 'builtin' | 'registration'>,
): AgentPolicy {
  return {
    editable: summary.registration ? [] : summary.builtin ? EDITABLE : ['name', ...EDITABLE],
    disable: summary.record.id !== builtinAgentId(DEFAULT_AGENT_HANDLE),
    delete: !summary.builtin && !summary.registration,
    // Copying an imported definition alone would discard its unreviewed policy constraints.
    duplicate: !summary.registration,
    capabilities: true,
  }
}

export const FIELD_LABELS: Record<AgentField, string> = {
  id: 'identity',
  name: 'handle',
  label: 'title',
  description: 'description',
  prompt: 'instructions',
  leadershipPriority: 'hierarchy priority',
  model: 'model preference',
  maxTurns: 'limits',
  context: 'context',
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

export function lockedChanges(
  policy: AgentPolicy,
  before: AgentRecord,
  after: AgentRecord,
): AgentField[] {
  return (Object.entries(FIELD_KEYS) as [AgentField, readonly (keyof AgentRecord)[]][])
    .filter(
      ([field, keys]) =>
        !canEditField(policy, field) &&
        keys.some(
          (key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null),
        ),
    )
    .map(([field]) => field)
}
