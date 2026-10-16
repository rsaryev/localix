/**
 * The `plan` tool's host port for one run: the conversation's plan lives on its ROOT, whose mode
 * an approval changes, so every action is keyed by the root whichever session the run is in.
 *
 * The mode is read LIVE, at call time, from the root's stored record — not from the mode the run
 * was admitted under. The person can switch the mode while a long run is under way, and a
 * `present` that trusted the admission-time mode would put a review card in front of someone who
 * has just told the agent to stop planning and work.
 */
import { DEFAULT_PERMISSION_MODE } from '../../../capabilities/permission-modes'
import type { PlanToolOptions } from '../../../agent-core/tools/plan/plan'
import type {
  PlanOverview,
  PlanPresentation,
  PresentInput,
  SessionPlan,
} from '../../../plans/contracts'
import type { ChatRepository } from '../../repository'

type Owner = { userId: string; sessionId: string }

/** The slice of the plans service a run reaches — typed here, since `run/` imports no service. */
export interface RunPlansPort {
  present(owner: Owner, authorAgentId: string, input: PresentInput): Promise<PlanPresentation>
  overview(owner: Owner): Promise<PlanOverview>
  complete(owner: Owner, summary: string): Promise<SessionPlan>
}

export function buildPlanOptions(
  plans: RunPlansPort,
  repo: Pick<ChatRepository, 'getSession'>,
  run: { userId: string; rootSessionId: string; agentId: string },
): PlanToolOptions {
  const owner = { userId: run.userId, sessionId: run.rootSessionId }
  return {
    inPlanMode: async () => {
      const root = await repo.getSession(run.userId, run.rootSessionId)
      return (root?.permissionMode ?? DEFAULT_PERMISSION_MODE) === 'plan'
    },
    present: (input) => plans.present(owner, run.agentId, input),
    overview: () => plans.overview(owner),
    complete: (summary) => plans.complete(owner, summary),
  }
}
