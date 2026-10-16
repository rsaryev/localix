/**
 * The approved plan a run's system prompt carries (`# Approved plan`), read once per run.
 *
 * Only the ROOT conversation's runs carry it. A delegated child implements the piece its brief
 * names; the whole plan in its prefix would cost every child request the plan's size for
 * context its delegator already distilled. A read failure leaves the section out rather than
 * failing the run — the plan is guidance, and the run can still proceed from its history.
 */
import type { ApprovedPlanPrompt } from '../../agent-core/system-prompt-plan-sections'
import type { PlanService } from '../../plans/service'
import { planRef } from '../../plans/plan-files'
import { planDraftDir, planDraftPath } from '../../plans/plan-paths'
import type { SessionRecord } from '../repository'

export async function approvedPlanForRun(
  plans: Pick<PlanService, 'approved'> | undefined,
  userId: string,
  session: Pick<SessionRecord, 'id' | 'parentSessionId'>,
): Promise<ApprovedPlanPrompt | undefined> {
  if (!plans || session.parentSessionId !== null) return undefined
  const plan = await plans.approved({ userId, sessionId: session.id }).catch(() => null)
  return plan
    ? { version: plan.version, title: plan.title, body: plan.body, path: plan.filePath }
    : undefined
}

/**
 * The run's own plan directory — the ROOT's runs only, the ones the conversation's plan belongs
 * to. The run's `defaultCwd` is the root's working dir (every session of the tree shares it), so
 * this is the directory the plans service reads and writes. A delegated child has none: a plan
 * file is not its to write, and the permission gate judges any plan-shaped write it makes as an
 * ordinary file write (`file-call-class.ts`).
 */
export function ownPlanDirForRun(
  session: Pick<SessionRecord, 'id' | 'seq' | 'parentSessionId'>,
  defaultCwd: string,
): string | undefined {
  return session.parentSessionId === null ? planDraftDir(defaultCwd, planRef(session)) : undefined
}

/** `# Plan mode` for a run admitted in it, naming the conversation's plan file. */
export function planModeForRun(
  session: Pick<SessionRecord, 'id' | 'seq' | 'parentSessionId' | 'permissionMode'>,
  defaultCwd: string,
): { draftPath?: string } | undefined {
  if (session.permissionMode !== 'plan') return undefined
  const dir = ownPlanDirForRun(session, defaultCwd)
  return dir ? { draftPath: planDraftPath(dir) } : {}
}
