/**
 * THE SESSION'S POLICY: every decision a session record alone answers, resolved in one place.
 *
 * Five axes, in a fixed order, each a pure function of the record (`axes/*`). Being pure is
 * what lets every layer ask: the wake queue choosing who answers, the service refusing a
 * membership change, a run's stages, its failure path long after the stages are gone, and the
 * browser. A run adds the axes that need the run itself (`run-policy.ts`).
 */
import { chooseOn, type AxisChoice } from './axis'
import {
  conversationAxis,
  conversationDecision,
  type ConversationDecision,
  type ConversationFacts,
} from './axes/conversation'
import { deliveryAxis, type DeliveryDecision, type DeliveryFacts } from './axes/delivery'
import { hostAxis, type HostDecision, type HostFacts } from './axes/host'
import { lineageAxis, type LineageDecision, type LineageFacts } from './axes/lineage'
import { permissionAxis, type PermissionDecision, type PermissionFacts } from './axes/permission'

export type SessionPolicyFacts = HostFacts &
  LineageFacts &
  ConversationFacts &
  DeliveryFacts &
  PermissionFacts

/** One entry per axis: which variant decided. `policy.trace` is how a run explains itself. */
export interface PolicyTraceEntry {
  axis: string
  variant: string
}

export interface SessionPolicy {
  host: HostDecision
  lineage: LineageDecision
  conversation: ConversationDecision
  delivery: DeliveryDecision
  permission: PermissionDecision
  trace: readonly PolicyTraceEntry[]
}

/** The session axes, in resolution order. Pinned by `policy-axes.test.ts`. */
export const SESSION_AXES = [
  hostAxis.name,
  lineageAxis.name,
  conversationAxis.name,
  deliveryAxis.name,
  permissionAxis.name,
] as const

const traced = <D>(axis: string, choice: AxisChoice<D>, trace: PolicyTraceEntry[]): D => {
  trace.push({ axis, variant: choice.variant })
  return choice.decision
}

export function resolveSessionPolicy(session: SessionPolicyFacts): SessionPolicy {
  const trace: PolicyTraceEntry[] = []
  return {
    host: traced(hostAxis.name, chooseOn(hostAxis, session), trace),
    lineage: traced(lineageAxis.name, chooseOn(lineageAxis, session), trace),
    conversation: traced(conversationAxis.name, chooseOn(conversationAxis, session), trace),
    delivery: traced(deliveryAxis.name, chooseOn(deliveryAxis, session), trace),
    permission: traced(permissionAxis.name, chooseOn(permissionAxis, session), trace),
    trace,
  }
}

/** The conversation decision alone — what dispatch and the membership writer need. */
export function conversationPolicy(session: ConversationFacts): ConversationDecision {
  return conversationDecision(session)
}

/** The host decision alone, for infrastructure that holds only a session kind. */
export function hostPolicy(session: HostFacts): HostDecision {
  return chooseOn(hostAxis, session).decision
}

/** The lineage decision alone, for paths that run after the stages are gone. */
export function lineagePolicy(session: LineageFacts): LineageDecision {
  return chooseOn(lineageAxis, session).decision
}

/** The permission decision alone: the mode, and whether the run is planning. */
export function permissionPolicy(session: PermissionFacts): PermissionDecision {
  return chooseOn(permissionAxis, session).decision
}

/** The delivery decision alone: the channel a reply is relayed through, if any. */
export function deliveryPolicy(session: DeliveryFacts): DeliveryDecision {
  return chooseOn(deliveryAxis, session).decision
}
