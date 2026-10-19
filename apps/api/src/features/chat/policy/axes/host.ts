/**
 * HOST — which kind of session a run lives in, and what that kind implies for its lifecycle.
 *
 * The tool surface a host carries is not decided here: every catalog entry declares its own
 * exposure per run shape (`agent-core/run-shape.ts`). This axis answers the questions the run
 * stages used to ask of `sessionKind` directly — whether a run's identity is remembered for its
 * later wakes, whether it writes a runtime status, whether queued input can steer it.
 */
import type { AgentSessionKind } from '../../../agent-core/run-shape'
import { defineAxis, type AxisVariant } from '../axis'

export interface HostFacts {
  sessionKind: AgentSessionKind
}

export interface HostDecision {
  kind: AgentSessionKind
  /**
   * A job or sub-agent session IS one dispatched task, so its later wakes run under the same
   * role. A chat's identity fields are one-run grants from a skill: remembering them would let a
   * later wake inherit `allowed-tools` it was never granted.
   */
  remembersRunIdentity: boolean
  /** A worker reports `runtimeStatus`; a chat's state is its transcript. */
  persistsRuntimeStatus: boolean
  /** Memory and skills are frozen per participant lane only in a chat (prefix cache). */
  freezesPromptContext: boolean
  /** Queued input may join a running turn; a passive system thread never runs one. */
  steers: boolean
  /** Background jobs need a host that watches them: never a job session itself. */
  supervisesJobs: boolean
  /** Live activity is mirrored into the parent session's work strip. */
  mirrorsActivityToParent: boolean
  /** Cards it raises are titled as a sub-agent's, in the chat that shows them. */
  presentsAsSubagent: boolean
}

const host = (
  kind: AgentSessionKind,
  decision: Omit<HostDecision, 'kind'>,
): AxisVariant<HostFacts, HostDecision> => ({
  id: kind,
  applies: (facts) => facts.sessionKind === kind,
  decide: () => ({ kind, ...decision }),
})

const worker = {
  remembersRunIdentity: true,
  persistsRuntimeStatus: true,
  freezesPromptContext: false,
  mirrorsActivityToParent: true,
} as const

export const hostAxis = defineAxis<HostFacts, HostDecision>('host', [
  host('chat', {
    remembersRunIdentity: false,
    persistsRuntimeStatus: false,
    freezesPromptContext: true,
    steers: true,
    supervisesJobs: true,
    mirrorsActivityToParent: false,
    presentsAsSubagent: false,
  }),
  host('subagent', { ...worker, steers: true, supervisesJobs: true, presentsAsSubagent: true }),
  host('job', { ...worker, steers: true, supervisesJobs: false, presentsAsSubagent: false }),
  host('system', {
    ...worker,
    mirrorsActivityToParent: false,
    steers: false,
    supervisesJobs: true,
    presentsAsSubagent: false,
  }),
])
