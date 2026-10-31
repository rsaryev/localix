/**
 * INVOCATION — how this run was started: by the conversation itself, a messaging channel, a
 * delegation, a loop, a verifier hook, or a continuation whose origin was not carried.
 *
 * Trusted provenance only (`runtime/execution-context.ts`): it is stamped by the host that
 * dispatched the run, never by a client. It names the host whose admission rules apply to the
 * agent (its `invocation:<host>` rules, `capabilities/builtin-agent-presets.ts`), so a run
 * cannot borrow a more trusted host's permissions.
 */
import type { RunInvocation } from '../../runtime/execution-context'
import { defineAxis, type AxisVariant } from '../axis'

export interface InvocationFacts {
  invocation: RunInvocation
}

export interface InvocationDecision {
  kind: RunInvocation['kind']
  /** The admission host the agent is admitted under. Missing provenance is `unknown`. */
  admissionHost: 'chat' | 'channel' | 'delegation' | 'automation' | 'verification' | 'unknown'
}

const invoked = (
  kinds: readonly RunInvocation['kind'][],
  admissionHost: InvocationDecision['admissionHost'],
): AxisVariant<InvocationFacts, InvocationDecision> => ({
  id: kinds.join('|'),
  applies: (facts) => kinds.includes(facts.invocation.kind),
  decide: (facts) => ({ kind: facts.invocation.kind, admissionHost }),
})

export const invocationAxis = defineAxis<InvocationFacts, InvocationDecision>('invocation', [
  invoked(['root'], 'chat'),
  invoked(['channel'], 'channel'),
  invoked(['task-delegation', 'skill-fork'], 'delegation'),
  invoked(['loop-subsession'], 'automation'),
  invoked(['hook'], 'verification'),
  // Missing provenance cannot acquire the privileges of a known execution host.
  invoked(['isolated-continuation'], 'unknown'),
])
