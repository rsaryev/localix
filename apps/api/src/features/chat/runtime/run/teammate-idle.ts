/**
 * Claude Code's TeammateIdle: a conversation member — a participant that is neither the leader
 * nor working alone — finished its turn and is about to go quiet. Its handle is CC's
 * `teammate_name`. An exit 2 keeps it working, with the reason as its next instruction (the same
 * continuation a Stop block uses); `continue:false` stops it outright, the reason shown as a hook
 * notice.
 */
import { agentRoute } from '../../../../contracts/session-route'
import type { CcHooksRuntime } from '../../../cc-hooks'
import type { RunPolicy } from '../../policy/run-policy'
import type { SessionRecord } from '../../repository'

export interface TeammateIdleOutcome {
  /** The member keeps working: the continuation's instruction. */
  keepWorking?: string
  /** The member was stopped outright; no hook may send it back to work this turn. */
  stopped?: boolean
}

export async function runTeammateIdle(
  ccHooks: CcHooksRuntime,
  policy: RunPolicy,
  session: SessionRecord,
  agentId: string,
  notice: (message: string) => void,
): Promise<TeammateIdleOutcome> {
  if (!ccHooks.active || policy.seat.role !== 'member') return {}
  const name = agentRoute(session, agentId)?.handle ?? agentId
  const verdict = await ccHooks.runTeammateIdle({ name, agentId })
  if (verdict.stopReason) {
    notice(verdict.stopReason)
    return { stopped: true }
  }
  if (!verdict.blocked) return {}
  return {
    keepWorking: verdict.reason || 'A TeammateIdle hook asked you to keep working. Continue.',
  }
}
