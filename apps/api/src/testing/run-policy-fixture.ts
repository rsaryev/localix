import type { SessionRecord } from '../features/chat/repository-types'
import {
  resolveRunPolicy,
  type RunPolicy,
  type RunPolicyFacts,
} from '../features/chat/policy/run-policy'

/**
 * The policy a run of `session` resolves, for a test that needs one to exist rather than to be
 * interesting: a root invocation, a reachable chat, a person's message. `over` is what the case
 * is about — the hitl route, the invocation.
 */
export function runPolicyFixture(
  session: SessionRecord,
  over: Partial<Omit<RunPolicyFacts, 'session'>> = {},
): RunPolicy {
  return resolveRunPolicy({
    session,
    invocation: { kind: 'root' },
    trigger: { continuation: false },
    hitl: { targetSessionId: session.id, reachable: true },
    ...over,
  })
}
