import type {
  ClientJournalOp,
  InboxChange,
  InboxEntry,
  InboxSyncResponse,
} from '@localixai/api/notification-contracts'

import type { InboxSocket } from './inboxSync'
import type { JournalTransport } from './journalDelivery'

/** A server inbox row, as `GET /rpc/notifications` returns it. */
export function inboxRow(key: string, over: Partial<InboxEntry> = {}): InboxEntry {
  const at = over.createdAt ?? 1_000
  return {
    key,
    seq: 1,
    topic: 'application.notification',
    category: 'system',
    severity: 'info',
    title: key,
    origin: { kind: 'application' },
    condition: false,
    state: 'open',
    occurrenceCount: 1,
    firstSeenAt: at,
    lastSeenAt: at,
    createdAt: at,
    ...over,
  }
}

export const change = (seq: number, entry: InboxEntry): InboxChange => ({
  seq,
  entry: { ...entry, seq },
})

/** A socket the test drives: `connect()` opens it, `frame()` delivers an `n` frame. */
export function fakeSocket() {
  const frames = new Set<(json: string) => void>()
  const connected = new Set<() => void>()
  const disconnected = new Set<() => void>()
  const socket: InboxSocket = {
    onFrame: (_tag, handler) => (frames.add(handler), () => frames.delete(handler)),
    onConnected: (handler) => (connected.add(handler), () => connected.delete(handler)),
    onDisconnect: (handler) => (disconnected.add(handler), () => disconnected.delete(handler)),
  }
  return {
    socket,
    connect: () => connected.forEach((handler) => handler()),
    disconnect: () => disconnected.forEach((handler) => handler()),
    frame: (value: InboxChange) => frames.forEach((handler) => handler(JSON.stringify(value))),
  }
}

/** A server the test scripts: what each sync answers, and whether a POST lands. */
export function fakeServer(options: { sync?: (since: number) => InboxSyncResponse } = {}) {
  const state = {
    syncs: [] as number[],
    posts: [] as ClientJournalOp[][],
    down: false,
    reject: false,
    /** What a POST answers with, per op; defaults to nothing changed. */
    answer: (_op: ClientJournalOp): InboxChange[] => [],
  }
  const transport: JournalTransport = {
    async sync(since) {
      state.syncs.push(since)
      if (state.down) throw new Error('unreachable')
      return options.sync?.(since) ?? { changes: [], cursor: since, floor: 0, full: since === 0 }
    },
    async post(ops) {
      if (state.down) throw new Error('unreachable')
      state.posts.push([...ops])
      if (state.reject) return 'rejected'
      return ops.flatMap((op) => state.answer(op))
    },
  }
  return { state, transport }
}

/** Let queued microtasks, the flush and the fake transport's promises run. */
export async function drain(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}
