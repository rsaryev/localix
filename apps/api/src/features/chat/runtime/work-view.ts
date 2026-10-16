/**
 * The composer's view of a work record — the one projection both the read model and the
 * `session_work.updated` push use, so a reload and a live update cannot disagree.
 */
import type { WorkRecord } from '../../work/contracts'
import type { WorkRegistry } from '../../work/registry'
import type { SessionWork } from '../contracts'

export function toSessionWork(record: WorkRecord): SessionWork {
  return {
    id: record.displayId,
    kind: record.kind,
    label: record.label,
    startedAt: record.startedAt,
    toolCallId: record.toolCallId,
    terminalId: record.terminalId,
    eventCount: record.eventCount,
    lastEvent: record.lastEvent,
    lastEventAt: record.lastEventAt,
  }
}

/** The session's running work, as the composer lists it. */
export const sessionWork = (work: WorkRegistry, userId: string, sessionId: string): SessionWork[] =>
  work.list({ userId, sessionId }).map(toSessionWork)
