/**
 * THE WORK REGISTRY: the one place a session's background work is recorded, named and found.
 *
 * It answers the questions the process-wide job map used to answer piecemeal:
 *
 *   - WHAT is running for this session? `list`, behind the ONE owner filter. The map was shared by
 *     every user and session, and each reader re-spelled the filter — a reader that forgot it
 *     leaked another session's jobs into a listing and let it kill them;
 *   - WHAT is it called? `mint` — one monotonic namespace per session and prefix. The map reused
 *     the lowest free `bg-N`, so the agent's "bg-1 finished" and a new bg-1 named different jobs,
 *     and the monitor service minted `mon-N` itself with a different scope;
 *   - WHAT happened to it across a restart? `hydrate` — work a dead process left `running` becomes
 *     `lost`. The map forgot it, and its transcript item claimed to be running forever.
 *
 * The live index keyed by tool call is authoritative in this process — jobs are registered from
 * synchronous tool paths, and every reader here uses it. Rows are written behind it, best-effort,
 * because what they are for is the next process: spent ids, and evidence of what was lost.
 */
import { randomUUID } from 'node:crypto'

import { errorMessage } from '../../lib/errors'
import {
  displayPrefix,
  type WorkKind,
  type WorkOwner,
  type WorkRecord,
  type WorkStatus,
} from './contracts'
import type { WorkRepository } from './repository'

export interface StartWork {
  owner: WorkOwner
  agentId: string | null
  kind: WorkKind
  label: string
  toolCallId: string
  messageId: string | null
  /** An id already minted here and published to the agent (a monitor names itself first). */
  displayId?: string
  /** The delegated child a `subagent` record stands for. */
  childSessionId?: string
}

/** What an end observer learns beside the record: whether the ending opens a turn of the agent's. */
export interface WorkEnding {
  wakesAgent: boolean
}

/** Kinds whose owner may resume them after a restart — a monitor's wait is a trigger's row. */
const RESUMABLE: readonly WorkKind[] = ['monitor']

export interface WorkRegistryDeps {
  repo: WorkRepository
  now?: () => Date
  logger?: { warn: (msg: string) => void }
}

export function createWorkRegistry(deps: WorkRegistryDeps) {
  const now = deps.now ?? (() => new Date())
  const live = new Map<string, WorkRecord>()
  /** Running work a boot holds for its owner to adopt — see `hydrate`. */
  const pending = new Map<string, WorkRecord>()
  const marks = new Map<string, number>()
  const owns = (record: WorkRecord, owner: WorkOwner) =>
    record.userId === owner.userId && record.sessionId === owner.sessionId
  const behind = (what: string, write: () => Promise<unknown>) =>
    void write().catch((error: unknown) =>
      deps.logger?.warn(`work record ${what} not stored: ${errorMessage(error)}`),
    )
  // A subscription rather than a constructor dependency: the registry is built at boot, before the
  // stream that publishes its changes exists.
  const listeners = new Set<(owner: WorkOwner) => void>()
  const changed = (owner: WorkOwner) => {
    for (const listener of listeners)
      try {
        listener({ userId: owner.userId, sessionId: owner.sessionId })
      } catch (error) {
        deps.logger?.warn(`work change listener failed: ${errorMessage(error)}`)
      }
  }

  // How each piece of work ENDED, for observers that report it (the notification producers). Also
  // a subscription: it must see the losses `hydrate` finds, which happen before the stream exists.
  const endListeners = new Set<(record: WorkRecord, ending: WorkEnding) => void>()
  const announceEnd = (record: WorkRecord, ending: WorkEnding) => {
    for (const listener of endListeners)
      try {
        listener(record, ending)
      } catch (error) {
        deps.logger?.warn(`work end listener failed: ${errorMessage(error)}`)
      }
  }

  const mint = (owner: WorkOwner, kind: WorkKind): string => {
    const prefix = displayPrefix(kind)
    const key = `${owner.sessionId}:${prefix}`
    const n = (marks.get(key) ?? 0) + 1
    marks.set(key, n)
    return `${prefix}-${n}`
  }

  const end = (
    toolCallId: string,
    // `wakesAgent`: a `notify` job's exit or a promoted call's result opens a turn, which reports it.
    outcome: { status: WorkStatus; exitCode?: number | null; wakesAgent?: boolean },
  ) => {
    const record = live.get(toolCallId)
    if (!record) return undefined
    live.delete(toolCallId)
    const ended: WorkRecord = {
      ...record,
      status: outcome.status,
      exitCode: outcome.exitCode ?? null,
      endedAt: now().toISOString(),
    }
    behind(`end ${record.displayId}`, () =>
      deps.repo.end(record.id, {
        status: ended.status,
        exitCode: ended.exitCode,
        endedAt: ended.endedAt!,
      }),
    )
    changed(record)
    announceEnd(ended, { wakesAgent: outcome.wakesAgent === true })
    return ended
  }

  return {
    /**
     * Once at boot, before any work starts: learn the ids already spent, and mark what the dead
     * process left running as lost. Answers the lost records, for the host to correct the
     * transcript items that still claim to run.
     *
     * A MONITOR is not decided here. Its schedule is a trigger's row, and a polled wait resumes
     * across a restart — so its work is held until the triggers have loaded: `adopt` takes back
     * what resumed, and `losePending` loses the rest.
     */
    async hydrate(): Promise<WorkRecord[]> {
      for (const mark of await deps.repo.highWaterMarks())
        marks.set(`${mark.sessionId}:${mark.prefix}`, mark.n)
      const lost = await deps.repo.loseRunning(now().toISOString(), RESUMABLE)
      for (const record of await deps.repo.listRunning(RESUMABLE))
        pending.set(record.toolCallId, record)
      for (const record of lost) announceEnd(record, { wakesAgent: false })
      return lost
    },

    /** A resumed owner takes its work back: it is running again, in this process. */
    adopt(toolCallId: string): WorkRecord | undefined {
      const record = pending.get(toolCallId)
      if (!record) return undefined
      pending.delete(toolCallId)
      live.set(toolCallId, record)
      changed(record)
      return record
    },

    /** Held work no owner took back was lost with the old process. Once, after the owners load. */
    async losePending(): Promise<WorkRecord[]> {
      const endedAt = now().toISOString()
      const lost = [...pending.values()].map((record): WorkRecord => ({
        ...record,
        status: 'lost',
        endedAt,
      }))
      pending.clear()
      for (const record of lost)
        await deps.repo
          .end(record.id, { status: 'lost', exitCode: null, endedAt })
          .catch((error: unknown) =>
            deps.logger?.warn(`work record ${record.displayId} not lost: ${errorMessage(error)}`),
          )
      for (const record of lost) announceEnd(record, { wakesAgent: false })
      return lost
    },

    /** A monitor saw something: count it, keep the latest, and show it. */
    recordEvents(toolCallId: string, events: readonly { text: string; at: number }[]): void {
      const record = live.get(toolCallId)
      const last = events.at(-1)
      if (!record || !last) return
      record.eventCount += events.length
      record.lastEvent = last.text
      record.lastEventAt = new Date(last.at).toISOString()
      const seen = {
        eventCount: record.eventCount,
        lastEvent: record.lastEvent,
        lastEventAt: record.lastEventAt,
      }
      behind(`events of ${record.displayId}`, () => deps.repo.recordEvents(record.id, seen))
      changed(record)
    },

    mint,

    /** Called with the owning session each time its set of running work changes. */
    onChange(listener: (owner: WorkOwner) => void): () => void {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },

    /** Called once per piece of work that ended — by `end`, `release`, or a restart's loss. */
    onEnded(listener: (record: WorkRecord, ending: WorkEnding) => void): () => void {
      endListeners.add(listener)
      return () => void endListeners.delete(listener)
    },

    start(input: StartWork): WorkRecord {
      const record: WorkRecord = {
        id: randomUUID(),
        userId: input.owner.userId,
        sessionId: input.owner.sessionId,
        agentId: input.agentId,
        displayId: input.displayId ?? mint(input.owner, input.kind),
        kind: input.kind,
        label: input.label,
        status: 'running',
        exitCode: null,
        toolCallId: input.toolCallId,
        messageId: input.messageId,
        terminalId: null,
        childSessionId: input.childSessionId ?? null,
        eventCount: 0,
        lastEvent: null,
        lastEventAt: null,
        startedAt: now().toISOString(),
        endedAt: null,
      }
      live.set(input.toolCallId, record)
      behind(`start ${record.displayId}`, () => deps.repo.insert(record))
      changed(input.owner)
      return record
    },

    /** The first flush of a PTY job carries its terminal. */
    setTerminal(toolCallId: string, terminalId: string): void {
      const record = live.get(toolCallId)
      if (!record || record.terminalId) return
      record.terminalId = terminalId
      behind(`terminal of ${record.displayId}`, () => deps.repo.setTerminal(record.id, terminalId))
      // Visible: the terminal is what makes the row openable.
      changed(record)
    },

    end,

    /** The work's live handle went away without reporting an end: someone stopped it. */
    release(toolCallId: string): void {
      end(toolCallId, { status: 'cancelled' })
    },

    get: (toolCallId: string): WorkRecord | undefined => live.get(toolCallId),

    /** The session's running work, oldest first. THE owner filter. */
    list: (owner: WorkOwner): WorkRecord[] =>
      [...live.values()].filter((record) => owns(record, owner)),

    /** Find running work by the id the agent uses, or by its tool call — the caller's own only. */
    resolve(owner: WorkOwner, id: string): WorkRecord | undefined {
      const byCall = live.get(id)
      if (byCall && owns(byCall, owner)) return byCall
      return [...live.values()].find((record) => owns(record, owner) && record.displayId === id)
    },

    /**
     * The occupancy of the per-session job cap: running work that holds a process. A sub-agent
     * holds none — the delegation budget bounds it — and counting it here would let two
     * delegations refuse a `bash background:true` the cap was never meant to stop.
     */
    count: (owner: WorkOwner): number =>
      [...live.values()].filter((record) => owns(record, owner) && record.kind !== 'subagent')
        .length,

    /** Distinct sessions with running work. */
    owners(): WorkOwner[] {
      const seen = new Map<string, WorkOwner>()
      for (const record of live.values())
        seen.set(`${record.userId}:${record.sessionId}`, {
          userId: record.userId,
          sessionId: record.sessionId,
        })
      return [...seen.values()]
    },

    /** The session was deleted; its rows went with the foreign-key cascade. */
    forgetSession(sessionId: string): void {
      for (const [toolCallId, record] of live)
        if (record.sessionId === sessionId) live.delete(toolCallId)
      for (const [toolCallId, record] of pending)
        if (record.sessionId === sessionId) pending.delete(toolCallId)
      for (const key of marks.keys()) if (key.startsWith(`${sessionId}:`)) marks.delete(key)
    },
  }
}

export type WorkRegistry = ReturnType<typeof createWorkRegistry>
