import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../../db/types'
import { delegationReportKey } from '../runtime/delegation-report'
import { recordDecidedDelivery } from '../runtime/delivery-receipts'
import { latestReportKeyParts } from '../repository-delegation-recovery'

/**
 * The delegator stopped this child (`TaskStop`), so no report of it is owed — and the recovery
 * sweep must know it was decided.
 *
 * A run that was stopped records that itself, at its end (`run/child-run-report.ts`). A child
 * that never ran — it was waiting for a lane and was withdrawn — has no run end, and the sweep
 * read "settled, no receipt" as a report lost with the process: ninety seconds after the answer
 * "no reply follows", it woke the agent with "STOPPED" (LOCALIX-430). The receipt is keyed as the
 * sweep keys the child's latest run, so the sweep counts it done.
 */
export async function recordChildStopped(
  db: Kysely<AppDatabase>,
  userId: string,
  childSessionId: string,
): Promise<void> {
  const latest = await latestReportKeyParts(db, userId, childSessionId)
  if (!latest) return
  await recordDecidedDelivery(db, {
    deliveryKey: delegationReportKey(childSessionId, latest.runId),
    userId,
    sessionId: latest.parentSessionId,
  })
}
