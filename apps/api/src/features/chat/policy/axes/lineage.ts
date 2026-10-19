/**
 * LINEAGE — where a session sits in its tree: the conversation itself, a branch of it (a thread
 * or a fork), a delegated child, or a worker another session started.
 *
 * Lineage is what decides authority that must never come from an agent: only the original
 * conversation creates delegated work or authors registry agents, only the root owns the plan,
 * and only a delegated child reports its runs back. These used to be six predicates in six
 * modules, each spelling "the root" slightly differently.
 */
import { isDelegationParent } from '../../../agent-core/delegation-policy'
import { delegatesAt } from '../../../agent-core/delegation-hierarchy'
import type { AgentSessionKind } from '../../../agent-core/run-shape'
import { delegationPlace, type SessionProvenance } from '../../session-provenance'
import { defineAxis, type AxisVariant } from '../axis'

export interface LineageFacts {
  id: string
  sessionKind: AgentSessionKind
  parentSessionId: string | null
  rootSessionId?: string | null
  provenance: SessionProvenance
}

export interface LineageDecision {
  /** The tree's root session: plans, memory and the delegation budget are keyed by it. */
  rootId: string
  /** 0 for a conversation, 1 for its delegated child. */
  depth: number
  /** May create delegated child sessions (`delegate`). */
  mayDelegate: boolean
  /** May author registry agents (`agents`). */
  managesAgents: boolean
  /** Owns the conversation's plan: its approved version and its draft directory. */
  ownsPlan: boolean
  /** Each of its runs is reported to the participant that delegated it. */
  reportsToDelegator: boolean
}

function decide(facts: LineageFacts): LineageDecision {
  const depth = delegationPlace(facts.provenance).depth
  return {
    rootId: facts.rootSessionId ?? facts.id,
    depth,
    mayDelegate: isDelegationParent(facts) && delegatesAt(depth),
    managesAgents: facts.sessionKind === 'chat' && facts.provenance.kind === 'root',
    ownsPlan: facts.parentSessionId === null,
    reportsToDelegator:
      facts.sessionKind === 'subagent' && facts.provenance.kind === 'task-delegation',
  }
}

const lineage = (
  id: string,
  applies: (facts: LineageFacts) => boolean,
): AxisVariant<LineageFacts, LineageDecision> => ({ id, applies, decide })

export const lineageAxis = defineAxis<LineageFacts, LineageDecision>('lineage', [
  lineage('conversation', (f) => f.sessionKind === 'chat' && f.provenance.kind === 'root'),
  lineage(
    'branch',
    (f) =>
      f.sessionKind === 'chat' && (f.provenance.kind === 'thread' || f.provenance.kind === 'fork'),
  ),
  lineage('delegated', (f) => f.provenance.kind === 'task-delegation'),
  lineage('worker', () => true),
])
