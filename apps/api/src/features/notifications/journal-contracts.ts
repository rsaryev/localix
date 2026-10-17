import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db/types'
import type {
  ClientJournalOp,
  InboxChange,
  InboxSyncResponse,
  RaiseFact,
  SettleFact,
} from './contracts'
import type { NotificationRepository } from './repository'

/** The journal's dependencies and surface; the single writer behind them is `journal.ts`. */
export interface NotificationJournalDeps {
  db: Kysely<AppDatabase>
  /** Scrubs secrets (vault values, token patterns) from text before it is stored. */
  redact?: (userId: string, text: string) => string
  log?: (event: string, detail: Record<string, unknown>) => void
  now?: () => number
}

export interface NotificationJournal {
  /** Raise a fact. Fire-and-forget: the caller never waits on or fails with the journal. */
  record(userId: string, fact: RaiseFact): void
  /** Settle one row or a prefix of rows. Fire-and-forget. */
  settle(userId: string, fact: SettleFact): void
  /** Apply a client's batch; a retried op id is a no-op. Resolves with what changed. */
  apply(userId: string, ops: readonly ClientJournalOp[]): Promise<InboxChange[]>
  sync(userId: string, since: number): Promise<InboxSyncResponse>
  subscribe(userId: string, listener: (change: InboxChange) => void): () => void
  /** Resolves once everything queued so far is committed (boot ordering, tests). */
  flush(): Promise<void>
  /**
   * Stop taking facts and commit what is queued: the first step of server shutdown, before the
   * producers are torn down and long before the database closes. Teardown is not news (the person
   * quit the app), so a job or terminal killed by it raises no row; a later `record`/`settle` is
   * dropped and `apply` rejects. Idempotent.
   */
  close(): Promise<void>
  /** Apply retention (`retention.ts`) behind the queued writes; resolves with rows removed. */
  prune(): Promise<number>
  repository: NotificationRepository
}
