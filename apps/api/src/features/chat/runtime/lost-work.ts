/**
 * Tell the transcript how work ended when the process that was writing its card is gone.
 *
 * A background job's tool item is rewritten on every flush of its output, the last time with its
 * final status — by the run that started it. When the process running it dies, that last write
 * never happens, so the item keeps `jobStatus: 'running'` — and every surface that renders it (the
 * card's live badge, the "Open terminal" action) went on treating a dead job as live, forever.
 * Two facts reach an item that way:
 *
 *   - `markLostWorkItems` — the work registry found work a dead process left running. Before any
 *     client connects, so no publish is needed: the first read already sees it;
 *   - `settleWorkItem` — a monitor that a restart RESUMED ended later, in a process whose run
 *     never wrote its card. A client may be watching, so the corrected row is published.
 *
 * Each item is patched independently, and a failure is logged rather than thrown — a stale badge
 * is worth less than a boot, or than the wake that follows it.
 */
import { isToolBackedItem, type CommandJobStatus } from '@localixai/agent/agents'

import { errorMessage } from '../../../lib/errors'
import type { WorkRecord } from '../../work/contracts'
import type { ChatRepository } from '../repository'
import { publishMessageSnapshot } from './message-persistence'
import type { SessionStreamRegistry } from './session-stream-registry'

export interface ItemEnding {
  status: 'completed' | 'failed' | 'aborted'
  jobStatus: CommandJobStatus
}

/** How an item reads for work that ended with this status. */
export function itemEndingOf(status: WorkRecord['status']): ItemEnding {
  switch (status) {
    case 'succeeded':
      return { status: 'completed', jobStatus: 'completed' }
    case 'cancelled':
      return { status: 'aborted', jobStatus: 'killed' }
    case 'timed-out':
      return { status: 'aborted', jobStatus: 'timeout' }
    case 'lost':
    case 'running':
      return { status: 'aborted', jobStatus: 'lost' }
    case 'failed':
      return { status: 'failed', jobStatus: 'failed' }
  }
}

export interface WorkItemPorts {
  repo: Pick<ChatRepository, 'getMessage' | 'updateMessage'>
  /** Absent before clients connect: the first read sees the row. */
  streamRegistry?: SessionStreamRegistry
}

/** Patch the item showing `record` to `ending`. True when there was an item to patch. */
export async function settleWorkItem(
  ports: WorkItemPorts,
  record: WorkRecord,
  ending: ItemEnding,
  nowIso: string,
): Promise<boolean> {
  if (!record.messageId) return false
  const message = await ports.repo.getMessage(record.userId, record.sessionId, record.messageId)
  const items = message?.payload.items
  if (!message || !items?.some((it) => isToolBackedItem(it) && it.toolCallId === record.toolCallId))
    return false
  const patched = items.map((item) =>
    isToolBackedItem(item) && item.toolCallId === record.toolCallId ? { ...item, ...ending } : item,
  )
  const written = await ports.repo.updateMessage(
    record.userId,
    record.sessionId,
    record.messageId,
    { items: patched },
    nowIso,
  )
  if (ports.streamRegistry)
    publishMessageSnapshot({
      streamRegistry: ports.streamRegistry,
      userId: record.userId,
      sessionId: record.sessionId,
      messageId: record.messageId,
      payload: written?.payload ?? { ...message.payload, items: patched },
      createdAt: message.createdAt,
      updatedAt: nowIso,
    })
  return true
}

export async function markLostWorkItems(
  repo: WorkItemPorts['repo'],
  lost: readonly WorkRecord[],
  nowIso: string,
  logger?: { warn: (msg: string) => void },
): Promise<number> {
  let marked = 0
  for (const record of lost) {
    try {
      if (await settleWorkItem({ repo }, record, itemEndingOf('lost'), nowIso)) marked += 1
    } catch (error) {
      logger?.warn(`[boot] could not mark lost work ${record.displayId}: ${errorMessage(error)}`)
    }
  }
  return marked
}
