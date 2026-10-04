import type { createUsageRepository } from '../../usage/repository'
import { readSessionUsageRows, summarizeSessionUsageFromTurns } from '../../usage/session-summary'
import type { ChatRepository } from '../repository'
import type { SessionStreamRegistry } from './session-stream-registry'

// A unique identity avoids the ABA race that a per-key numeric counter creates
// when the latest request finishes (and removes the key) before another request
// starts while an even older read is still in flight.
const latestSnapshotRequest = new Map<string, symbol>()

/** Publish one backend-authoritative all-history snapshot after auxiliary billing settles. */
export async function publishSessionUsageSnapshot(args: {
  repo: Pick<ChatRepository, 'getActiveBranchUsage'>
  usageRepo: ReturnType<typeof createUsageRepository>
  streamRegistry: SessionStreamRegistry
  userId: string
  sessionId: string
}): Promise<void> {
  const key = `${args.userId}\0${args.sessionId}`
  const request = Symbol(key)
  latestSnapshotRequest.set(key, request)
  try {
    const [turns, ledgerByKind] = await Promise.all([
      args.repo.getActiveBranchUsage(args.userId, args.sessionId),
      readSessionUsageRows(args.usageRepo, args.userId, args.sessionId),
    ])
    // Several model/aux writes may settle together. A slower older query must
    // never overwrite the newer all-history snapshot on either client.
    if (latestSnapshotRequest.get(key) !== request) return
    args.streamRegistry.publish(args.userId, args.sessionId, {
      type: 'session_usage.updated',
      sessionId: args.sessionId,
      usage: summarizeSessionUsageFromTurns(turns, ledgerByKind).usage ?? null,
    })
    latestSnapshotRequest.delete(key)
  } catch (error) {
    if (latestSnapshotRequest.get(key) === request) latestSnapshotRequest.delete(key)
    // Usage accounting is already durable. A transient read/publish failure must
    // not fail the auxiliary call that billed it; reconnect hydration reads the same snapshot.
    console.warn('[session-usage] failed to publish usage snapshot', error)
  }
}
