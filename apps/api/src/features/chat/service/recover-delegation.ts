/**
 * THE RECOVERY HALF OF A CHILD'S REPORT: re-send a report whose live wake never reached durable
 * admission, and never rerun the child.
 *
 * The live seam (`run/child-run-report.ts`) reports each run of a child the moment it settles.
 * A process that dies between a run's end and its report's admission leaves a terminal child
 * whose LATEST run has no receipt; this sweep finds exactly those, for EVERY user who owns one,
 * and sends the same wake the live path would have (`delegationReportWake`, keyed by that run's
 * final assistant message, `receipt: true`), so whichever path reaches the store first is the
 * one report. Only the latest run is recovered: an earlier run's lost report is superseded by
 * the one after it, which is the state the parent needs to act on. A run whose report the live
 * seam decided AGAINST (stopped, or nobody was waiting on it) carries a receipt as well
 * (`recordDecidedDelivery`), so "no receipt" still means only "the process died first".
 *
 * It looks back only as far as receipts are kept (`delivery-receipts.ts`): past that horizon a
 * missing receipt may be a PRUNED one, and re-sending would be the duplicate the receipt exists
 * to stop. Pruning runs here too, so the table and the window move together.
 */
import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../../db/types'
import type { createChatService } from '../service'
import { delegationReportWake, readRunReplies } from '../runtime/delegation-report'
import { pruneDeliveryReceipts } from '../runtime/delivery-receipts'
import {
  delegationRecoveryQuery,
  recoveryUsersQuery,
  runRowReader,
} from '../repository-delegation-recovery'

type Wake = ReturnType<typeof createChatService>['wakeSession']

/** The run's text and how it ended, read as the live seam reads them (`readRunReplies`). */
async function recoveredRun(db: Kysely<AppDatabase>, child: { id: string; run_id: string | null }) {
  const run = child.run_id
    ? await readRunReplies(child.run_id, runRowReader(db, child.id, child.run_id))
    : { text: null, waiting: false }
  return { text: run.text, ...(run.waiting ? { waiting: true } : {}) }
}

async function recoverForUser(
  db: Kysely<AppDatabase>,
  userId: string,
  wake: Wake,
  now: number,
): Promise<number> {
  let delivered = 0
  for (const child of await delegationRecoveryQuery(db, userId, now).execute()) {
    const parentSessionId = child.parent_session_id
    if (!parentSessionId) continue
    try {
      const result = await wake(
        delegationReportWake({
          ...(await recoveredRun(db, child)),
          userId,
          parent: { id: parentSessionId },
          label: child.title,
          childSessionId: child.id,
          runId: child.run_id ?? 'launch',
          status: child.runtime_status,
        }),
      )
      if (result.delivered) delivered++
    } catch (error) {
      // One unavailable parent must not starve unrelated completed children. No
      // receipt is written here: failed admission remains eligible on the next start's sweep.
      console.warn('[delegate] recovered report delivery failed:', child.id, error)
    }
  }
  return delivered
}

/** Prune expired receipts, then recover every user's unreported children. Never rerun them. */
export async function recoverDelegationReports(
  db: Kysely<AppDatabase>,
  wake: Wake,
  now = Date.now(),
): Promise<number> {
  await pruneDeliveryReceipts(db, now)
  let delivered = 0
  for (const { user_id } of await recoveryUsersQuery(db, now).execute())
    delivered += await recoverForUser(db, user_id, wake, now)
  return delivered
}
