import type { SessionRecord } from '../../repository'

type SessionListRepository = {
  listRunSessionSnapshotRows(userId: string): Promise<RunSessionSnapshotRow[]>
}

export type RunSessionSnapshotRow = Pick<
  SessionRecord,
  'id' | 'userId' | 'parentSessionId' | 'sessionKind' | 'runtimeStatus' | 'title' | 'provenance'
>

/**
 * One authoritative roster snapshot per run. Child sessions need it early for
 * HITL ancestry and every run needs it later for descendant prompt context; keep
 * the Promise itself so overlapping or sequential consumers cannot repeat the
 * full session query.
 */
export function createRunSessionSnapshot(
  repo: SessionListRepository,
  userId: string,
): () => Promise<RunSessionSnapshotRow[]> {
  let pending: Promise<RunSessionSnapshotRow[]> | undefined
  return () => {
    pending ??= repo.listRunSessionSnapshotRows(userId)
    return pending
  }
}
