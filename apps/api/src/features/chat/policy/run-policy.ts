/**
 * THE RUN'S POLICY: the session's decisions plus the ones only a run can make.
 *
 * Resolved once per run, before the agent is admitted (`runtime/run/stages/policy.ts`), and read
 * by every stage after it: which host admits the agent, who owns the topic, whether a person can
 * answer, why the turn started. A stage that needs to know one of these reads it here; it does
 * not ask the session record again. The trace records which variant decided each axis, and the
 * composition snapshot keeps it, so "why did this run behave so" has one place to look.
 *
 * Every axis is pure. The facts are gathered by the stage — the registry is read there, once.
 */
import { chooseOn, type Axis } from './axis'
import { humanAxis, type HumanDecision } from './axes/human'
import { invocationAxis, type InvocationDecision } from './axes/invocation'
import { seatAxis, type SeatDecision, type SeatMember } from './axes/seat'
import { triggerAxis, type TriggerDecision, type TriggerFacts } from './axes/trigger'
import {
  resolveSessionPolicy,
  SESSION_AXES,
  type PolicyTraceEntry,
  type SessionPolicy,
  type SessionPolicyFacts,
} from './session-policy'
import type { RunInvocation } from '../runtime/execution-context'

export interface RunPolicyFacts {
  session: SessionPolicyFacts & { agents: readonly SeatMember[] }
  speakerAgentId: string
  invocation: RunInvocation
  trigger: TriggerFacts
  hitl: { targetSessionId: string | null; reachable: boolean }
  /** Leadership priority by agent id, from the registry read once for this run. */
  priorities: ReadonlyMap<string, number>
}

export interface RunPolicy extends SessionPolicy {
  invocation: InvocationDecision
  seat: SeatDecision
  trigger: TriggerDecision
  human: HumanDecision
}

/** Every axis, in resolution order: the session's first, then the run's. */
export const RUN_AXES = [
  ...SESSION_AXES,
  invocationAxis.name,
  seatAxis.name,
  triggerAxis.name,
  humanAxis.name,
] as const

export function resolveRunPolicy(facts: RunPolicyFacts): RunPolicy {
  const session = resolveSessionPolicy(facts.session)
  const trace: PolicyTraceEntry[] = [...session.trace]
  const pick = <F, D>(axis: Axis<F, D>, axisFacts: F): D => {
    const choice = chooseOn(axis, axisFacts)
    trace.push({ axis: axis.name, variant: choice.variant })
    return choice.decision
  }
  const invocation = pick(invocationAxis, { invocation: facts.invocation })
  const seat = pick(seatAxis, {
    conversation: session.conversation,
    agents: facts.session.agents,
    speakerAgentId: facts.speakerAgentId,
    priorities: facts.priorities,
  })
  const trigger = pick(triggerAxis, facts.trigger)
  const human = pick(humanAxis, { hitl: facts.hitl, permission: session.permission })
  return { ...session, invocation, seat, trigger, human, trace }
}
