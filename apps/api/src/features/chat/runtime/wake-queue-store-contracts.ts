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
  state: 'pending' | 'leased'
  leaseOwner?: string
  leaseExpiresAt?: string
  deliveryKey: string
  queuedAt: string
  /** The band it was claimed in with others; kept until acknowledgement (`claim`). */
  batchId?: string
}

/**
 * What admission takes: the row, plus whether its delivery key is admitted once EVER. A receipt is
 * not part of the row — it outlives the row's acknowledgement, which is the whole point of it.
 */
export type QueueAdmission<TPayload = unknown> = Omit<
  DurableQueueItem<TPayload>,
  'sequence' | 'state' | 'batchId'
> & { receipt?: true }

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
  ack(
    userId: string,
    sessionId: string,
    ids: readonly string[],
    leaseOwner: string,
  ): Promise<boolean>
  release(
    userId: string,
    sessionId: string,
    ids: readonly string[],
    leaseOwner: string,
  ): Promise<void>
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
  state: 'pending' | 'leased'
  lease_owner: string | null
  lease_expires_at: string | null
  delivery_key: string
  queued_at: string
  batch_id: string | null
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
