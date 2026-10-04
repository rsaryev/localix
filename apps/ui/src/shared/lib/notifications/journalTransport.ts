import type {
  ClientJournalOp,
  InboxChange,
  InboxSyncResponse,
} from '@localixai/api/notification-contracts'

import { ApiError, client, unwrap } from '@/shared/api/internal'
import type { JournalTransport } from './journalDelivery'

/**
 * The journal's HTTP half: `GET /rpc/notifications?since=` and `POST /rpc/notifications/ops`
 * (`apps/api/src/features/notifications/routes.ts`). Live changes ride the socket instead.
 *
 * A batch the server REJECTS (malformed) would be rejected on every resend, so it is reported as
 * such and dropped; anything else — the API down, a 5xx — throws and is retried from the outbox.
 */
const NEVER_ACCEPTED = new Set([400, 413, 422])

export const httpJournalTransport: JournalTransport = {
  async sync(since: number): Promise<InboxSyncResponse> {
    return unwrap<InboxSyncResponse>(
      await client.rpc.notifications.$get({ query: { since: String(since) } }),
    )
  },
  async post(ops: readonly ClientJournalOp[]): Promise<InboxChange[] | 'rejected'> {
    try {
      const { changes } = await unwrap<{ changes: InboxChange[] }>(
        await client.rpc.notifications.ops.$post({ json: { ops: [...ops] } }),
      )
      return changes
    } catch (error) {
      if (error instanceof ApiError && NEVER_ACCEPTED.has(error.status)) return 'rejected'
      throw error
    }
  },
}
