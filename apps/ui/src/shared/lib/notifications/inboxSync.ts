import type { InboxChange } from '@localixai/api/notification-contracts'

import { eventSocket } from '@/shared/api/eventSocket'
import { startLiveInterruptions, type InterruptionDeps } from './interruption'
import {
  applyLiveChange,
  attachJournalTransport,
  journalConnected,
  journalDisconnected,
  type JournalTransport,
} from './journalDelivery'
import { httpJournalTransport } from './journalTransport'

/**
 * KEEPS THIS WINDOW'S COPY OF THE INBOX CURRENT.
 *
 * The server publishes every committed change as an `n` frame on the realtime socket
 * (`apps/api/src/features/realtime/ws.ts`) and keeps no replay ring — the journal is durable, so a
 * client catches up by reading it instead. Hence the order on every connect: the frame
 * subscription exists first (the server attaches it when the socket opens), THEN the sync reads
 * since the cursor. A change committed between the two arrives both ways, and the per-key `seq`
 * rule in `journal.ts` keeps it once.
 */

/** The socket's frame tag for a notification change. */
const NOTIFICATION_FRAME_TAG = 'n'

export interface InboxSocket {
  onFrame(tag: string, handler: (json: string) => void): () => void
  onConnected(handler: () => void): () => void
  onDisconnect(handler: () => void): () => void
}

function isChange(value: unknown): value is InboxChange {
  if (!value || typeof value !== 'object') return false
  const change = value as Record<string, unknown>
  if (typeof change.seq !== 'number') return false
  if (typeof change.removedKey === 'string') return true
  const entry = change.entry as Record<string, unknown> | undefined
  return !!entry && typeof entry.key === 'string' && typeof entry.title === 'string'
}

export function startNotificationSync(
  options: {
    socket?: InboxSocket
    transport?: JournalTransport
    interruption?: InterruptionDeps
  } = {},
): () => void {
  const socket = options.socket ?? eventSocket
  attachJournalTransport(options.transport ?? httpJournalTransport)
  const stopInterruptions = startLiveInterruptions(options.interruption)
  const offFrame = socket.onFrame(NOTIFICATION_FRAME_TAG, (json) => {
    let change: unknown
    try {
      change = JSON.parse(json)
    } catch {
      return
    }
    // A frame this client cannot read is dropped; the next resync delivers the row anyway.
    if (isChange(change)) applyLiveChange(change)
  })
  const offConnected = socket.onConnected(() => void journalConnected())
  const offDisconnect = socket.onDisconnect(journalDisconnected)
  // Read the journal NOW, over HTTP, not only when the socket opens. The socket carries live
  // changes; the history does not depend on it. A socket that never came up (a proxy that drops
  // WebSocket upgrades, a dev server without the WS base) left the window with an empty journal
  // although every row was one GET away — found by running the real app. When the socket opens
  // later, its connect reads again from the cursor, which is a no-op delta.
  void journalConnected()
  return () => {
    offFrame()
    offConnected()
    offDisconnect()
    stopInterruptions()
    journalDisconnected()
    attachJournalTransport(null)
  }
}
