import type { InvocationHost, InvocationRegistry } from '../capabilities/invocation'
import type { AgentRecord, AgentSummary } from './contracts'
import type { ResolvedCapabilities } from '../capabilities/resolve'
import { stableStringify } from '@localixai/agent'

/** Definition and policy from the catalog snapshot that admitted this invocation. */
export interface ResolvedRunAgent {
  definition: AgentRecord
  capabilities: ResolvedCapabilities
  approval: 'policy' | 'user'
}

export type RunAgentDecision =
  | { status: 'allowed'; agent: ResolvedRunAgent }
  | {
      status:
        | Exclude<AgentAvailability['status'], 'allowed'>
        | 'approval_unsupported'
        | 'catalog_incomplete'
        | 'approval_denied'
        /** The card expired: nobody refused it, nobody was there. See `decision-deadline.ts`. */
        | 'approval_unanswered'
        | 'approval_changed'
    }

/**
 * What came back from the approval card.
 *
 * Three values, not a boolean, because "nobody answered" is not "the user said no": the
 * caller reports them to the model in different words, and a delegation abandoned over an
 * empty room reads very differently from one a person refused.
 */
export type ApprovalAnswer = 'approved' | 'declined' | 'unanswered'

export interface AgentAvailability {
  agentId: string
  host: string
  status:
    | 'allowed'
    | 'unknown_host'
    | 'agent_not_found'
    | 'agent_disabled'
    | 'policy_denied'
    | 'approval_required'
}

type CatalogLoader = (
  userId: string,
  projectId: string,
) => Promise<{
  all: AgentSummary[]
  capabilitiesByAgent: ReadonlyMap<string, ResolvedCapabilities>
}>

function statusFor(
  agent: AgentSummary | undefined,
  invocation: InvocationHost | undefined,
): AgentAvailability['status'] {
  if (!invocation) return 'unknown_host'
  if (!agent) return 'agent_not_found'
  if (!agent.enabled) return 'agent_disabled'
  const effect = agent.invocations[invocation.id]
  if (effect === 'allow') return 'allowed'
  // This is the policy's answer, not a claim that this particular run can reach a human.
  if (effect === 'ask') return 'approval_required'
  return 'policy_denied'
}

/** Selection, explanation and unattended resolution share one catalog decision. */
export function createAgentInvocationService(
  loadCatalog: CatalogLoader,
  invocations: InvocationRegistry,
) {
  const explain = (
    agents: readonly AgentSummary[],
    agentId: string,
    host: string,
  ): AgentAvailability => {
    const invocation = invocations.list().find((entry) => entry.id === host)
    const agent = agents.find((entry) => entry.record.id === agentId)
    return { agentId, host, status: statusFor(agent, invocation) }
  }

  return {
    async resolveRunAgent(
      userId: string,
      agentId: string,
      host: string,
      projectId?: string | null,
      requestApproval?: (agent: AgentRecord) => Promise<ApprovalAnswer>,
    ): Promise<RunAgentDecision> {
      const scope = projectId ?? ''
      const catalog = await loadCatalog(userId, scope)
      const { status } = explain(catalog.all, agentId, host)
      if (status === 'approval_required' && !requestApproval) {
        return { status: 'approval_unsupported' }
      }
      if (status !== 'allowed' && status !== 'approval_required') return { status }
      const capabilities = catalog.capabilitiesByAgent.get(agentId)
      if (!capabilities) return { status: 'catalog_incomplete' }
      const entry = catalog.all.find((entry) => entry.record.id === agentId)!
      if (status === 'allowed') {
        return {
          status: 'allowed',
          agent: { definition: entry.record, capabilities, approval: 'policy' },
        }
      }
      // An ask approves only this exact definition and policy snapshot. A concurrent edit
      // requires a new request, even when it leaves the effective verdict as ask.
      const fingerprint = stableStringify({ entry, rules: capabilities.rules })
      const answer = await requestApproval!(entry.record)
      if (answer !== 'approved') {
        return { status: answer === 'unanswered' ? 'approval_unanswered' : 'approval_denied' }
      }
      const fresh = await loadCatalog(userId, scope)
      const freshEntry = fresh.all.find((candidate) => candidate.record.id === agentId)
      const freshCapabilities = fresh.capabilitiesByAgent.get(agentId)
      if (!freshEntry || !freshCapabilities) return { status: 'approval_changed' }
      if (stableStringify({ entry: freshEntry, rules: freshCapabilities.rules }) !== fingerprint) {
        return { status: 'approval_changed' }
      }
      return {
        status: 'allowed',
        agent: { definition: freshEntry.record, capabilities: freshCapabilities, approval: 'user' },
      }
    },

    async listInvocableAgents(userId: string, host: string, opts?: { projectId?: string | null }) {
      const projectId = opts?.projectId ?? ''
      const catalog = await loadCatalog(userId, projectId)
      const invocation = invocations.list().find((entry) => entry.id === host)
      return catalog.all.filter((entry) => statusFor(entry, invocation) === 'allowed')
    },

    async explainAgentAvailability(
      userId: string,
      agentId: string,
      host: string,
      projectId?: string | null,
    ): Promise<AgentAvailability> {
      const scope = projectId ?? ''
      const catalog = await loadCatalog(userId, scope)
      return explain(catalog.all, agentId, host)
    },

    async resolveInvocableAgent(
      userId: string,
      agentId: string,
      host: string,
      projectId?: string | null,
    ) {
      const scope = projectId ?? ''
      const catalog = await loadCatalog(userId, scope)
      if (explain(catalog.all, agentId, host).status !== 'allowed') return null
      return catalog.all.find((entry) => entry.record.id === agentId)!.record
    },
  }
}
