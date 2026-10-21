export type DurableQueueKind = 'user' | 'wake'

export const TURN_KINDS: readonly DurableQueueKind[] = ['user', 'wake']

export interface DurableQueueItem<TPayload = unknown> {
  id: string
  sequence: number
  userId: string
  sessionId: string
  priority: number
  kind: DurableQueueKind
  payload: TPayload
  state: DurableQueueState
  leaseOwner?: string
  leaseExpiresAt?: string
  deliveryKey: string
  queuedAt: string
  /** The band it was claimed in with others; kept until acknowledgement (`claim`). */
  batchId?: string
  /** The last delivery error of a `failed` row (`fail`). */
  failure?: string
}

/** `failed`: a delivery that exhausted its retries — off the head, kept until retried or removed. */
export type DurableQueueState = 'pending' | 'leased' | 'failed'

/**
 * What admission takes: the row, plus whether its delivery key is admitted once EVER. A receipt is
 * not part of the row — it outlives the row's acknowledgement, which is the whole point of it.
 */
export type QueueAdmission<TPayload = unknown> = Omit<
  DurableQueueItem<TPayload>,
  'sequence' | 'state' | 'batchId' | 'failure'
> & { receipt?: true }

/** A reply slot about to be filled by an acknowledged agent turn ticket. */
export interface TurnStart {
  assistantMessageId: string
  agentId: string
  at: string
}

export interface WakeQueueStore<TPayload = unknown> {
  /** False when a receipt says this delivery was already admitted. */
  enqueue(item: QueueAdmission<TPayload>): Promise<void | boolean>
  listAll(): Promise<DurableQueueItem<TPayload>[]>
  listSession(userId: string, sessionId: string): Promise<DurableQueueItem<TPayload>[]>
  /**
   * Lease every one of `ids` or none. `batchId` names a band of several: it is written with the
   * lease and survives a release or an expired lease, so the band replays with exactly its rows.
   */
  claim(
    userId: string,
    sessionId: string,
    ids: readonly string[],
    leaseOwner: string,
    now: string,
    leaseExpiresAt: string,
    batchId?: string,
  ): Promise<boolean>
  /** `starting`: the reply slot an agent turn ticket fills, recorded with the acknowledgement. */
  ack(
    userId: string,
    sessionId: string,
    ids: readonly string[],
    leaseOwner: string,
    starting?: TurnStart,
  ): Promise<boolean>
  /** The run for this reply slot has returned: its start is no longer in doubt. */
  turnStarted?(assistantMessageId: string): Promise<void>
  release(
    userId: string,
    sessionId: string,
    ids: readonly string[],
    leaseOwner: string,
  ): Promise<void>
  /** Extend this owner's lease on every one of `ids`; false when any of them is no longer held. */
  renew(
    userId: string,
    sessionId: string,
    ids: readonly string[],
    leaseOwner: string,
    leaseExpiresAt: string,
  ): Promise<boolean>
  /** Park this owner's leased `ids` as failed with `failure`, all or none. */
  fail(
    userId: string,
    sessionId: string,
    ids: readonly string[],
    leaseOwner: string,
    failure: string,
  ): Promise<boolean>
  /** Return failed `ids` to pending, all or none. */
  retry(userId: string, sessionId: string, ids: readonly string[]): Promise<boolean>
  /** Delete pending or failed `ids`, all or none (a batch leaves the queue whole). */
  removeMany(userId: string, sessionId: string, ids: readonly string[]): Promise<boolean>
  /** Delete one pending or failed row. */
  remove(userId: string, sessionId: string, id: string): Promise<boolean>
  setPriority(userId: string, sessionId: string, id: string, priority: number): Promise<boolean>
  updatePending?(
    userId: string,
    sessionId: string,
    id: string,
    priority: number,
    payload: TPayload,
  ): Promise<boolean>
  setPriorities?(
    userId: string,
    sessionId: string,
    updates: readonly { id: string; priority: number }[],
  ): Promise<boolean>
  recoverExpired(now: string): Promise<number>
  forgetSession(userId: string, sessionId: string): Promise<void>
}

interface PersistedQueueRow {
  id: string
  sequence: number
  user_id: string
  session_id: string
  priority: number
  kind: DurableQueueKind
  payload_json: string
  state: DurableQueueState
  lease_owner: string | null
  lease_expires_at: string | null
  delivery_key: string
  queued_at: string
  batch_id: string | null
  failure?: string | null
}

export function mapQueueRows<TPayload>(
  rows: readonly (Omit<PersistedQueueRow, 'kind'> & { kind: string })[],
): DurableQueueItem<TPayload>[] {
  const items: DurableQueueItem<TPayload>[] = []
  for (const row of rows) {
    if (!(TURN_KINDS as readonly string[]).includes(row.kind)) continue
    try {
      items.push({
        id: row.id,
        sequence: row.sequence,
        userId: row.user_id,
        sessionId: row.session_id,
        priority: row.priority,
        kind: row.kind as DurableQueueKind,
        payload: JSON.parse(row.payload_json) as TPayload,
        state: row.state,
        ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
        ...(row.lease_expires_at ? { leaseExpiresAt: row.lease_expires_at } : {}),
        deliveryKey: row.delivery_key,
        queuedAt: row.queued_at,
        ...(row.batch_id ? { batchId: row.batch_id } : {}),
        ...(row.state === 'failed' ? { failure: row.failure || 'Delivery failed' } : {}),
      })
    } catch (error) {
      console.error(
        `[wake-queue] quarantined unreadable row ${row.id} (session ${row.session_id}, kind ${row.kind}) — it will never be delivered`,
        error,
      )
    }
  }
  return items
}
