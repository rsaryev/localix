import type { SessionRecord } from '../features/chat/repository-types'
import {
  resolveRunPolicy,
  type RunPolicy,
  type RunPolicyFacts,
} from '../features/chat/policy/run-policy'

/**
 * The policy a run of `session` resolves for `speakerAgentId`, for a test that needs one to
 * exist rather than to be interesting: a root invocation, a reachable chat, a person's message.
 * `over` is what the case is about — the priorities that elect a leader, the hitl route.
 */
export function runPolicyFixture(
  session: SessionRecord,
  speakerAgentId: string = session.agents[0]!.agentId,
  over: Partial<Omit<RunPolicyFacts, 'session' | 'speakerAgentId'>> = {},
): RunPolicy {
  return resolveRunPolicy({
    session,
    speakerAgentId,
    invocation: { kind: 'root' },
    trigger: { continuation: false },
    hitl: { targetSessionId: session.id, reachable: true },
    priorities: new Map(),
    ...over,
  })
}
