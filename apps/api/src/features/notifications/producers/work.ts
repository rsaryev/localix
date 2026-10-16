import type { WorkRecord } from '../../work/contracts'
import type { WorkEnding } from '../../work/registry'
import type { NotificationJournal } from '../journal'
import type { RaiseFact } from '../contracts'
import {
  openChatAction,
  resourceOrigin,
  unknownSession,
  type LookupSession,
  type OrderedLane,
} from './facts'

/**
 * HOW BACKGROUND WORK ENDED — a job, a monitor, a stream, a promoted call — and a finished
 * background terminal no work record stands for.
 *
 * `WorkRegistry.end` is the one seam every kind of work ends through (and `hydrate`/`losePending`
 * the one seam for work a restart killed), so the registry's `onEnded` subscription is the whole
 * producer. What raises nothing:
 *   - a delegated sub-agent (`subagent`): its own run's end is reported as `child.*`, keyed per run;
 *   - an ending that WAKES the agent (a `notify` job, a promoted call, a monitor's wake): the woken
 *     turn reports it, and a second row would say the same thing twice.
 *
 * A PTY job is ALSO a terminal, and the terminal service announces every command pane's exit. So a
 * terminal's exit raises a row only when no work record stands for it — checked against the
 * session's running work and the terminals whose work already ended here — which leaves exactly
 * the panes nobody recorded (the agent's own `terminal` tool running a command).
 */

export interface TerminalFinished {
  terminalId: string
  exitCode: number
  command?: string
  finishedAt?: number
  stopped?: true
  interactive?: true
  wakesAgent?: true
}

/** What the terminal service publishes about a pane; only its exit is a fact worth a row. */
export type TerminalLifecycleEvent =
  | ({ type: 'terminal.finished' } & TerminalFinished)
  | { type: 'terminal.input' }

export interface WorkNotifications {
  ended(record: WorkRecord, ending: WorkEnding): void
  /** Takes every lifecycle event, so the terminal service's publisher can forward it whole. */
  terminalLifecycle(userId: string, sessionId: string, event: TerminalLifecycleEvent): void
}

export const workKey = (recordId: string) => `work:${recordId}`
export const terminalKey = (terminalId: string) => `terminal:${terminalId}`

/** How many ended work terminals are remembered for the terminal-exit check. */
const ENDED_TERMINALS_CAP = 256

const KIND_NAME: Record<WorkRecord['kind'], string> = {
  job: 'Background job',
  monitor: 'Monitor',
  stream: 'Stream',
  promoted: 'Background call',
  subagent: 'Sub-agent',
}

/**
 * Severity and wording follow the one table every producer uses: a finished child is `success`
 * (it was `info` here and `success` for the same sub-agent in `runs.ts`, so one fact read two
 * ways), a failure is titled "Could not …", and a stop someone chose is a quiet `info`.
 */
function describe(record: WorkRecord): Pick<RaiseFact, 'topic' | 'severity' | 'title'> | null {
  const name = KIND_NAME[record.kind]
  const lower = name.charAt(0).toLowerCase() + name.slice(1)
  switch (record.status) {
    case 'failed':
      return { topic: 'child.failed', severity: 'error', title: `Could not finish a ${lower}` }
    case 'timed-out':
      return {
        topic: 'child.failed',
        severity: 'error',
        title: `Could not finish a ${lower} in time`,
      }
    case 'succeeded':
      return { topic: 'child.completed', severity: 'success', title: `${name} finished` }
    case 'cancelled':
      return { topic: 'child.stopped', severity: 'info', title: `${name} stopped` }
    case 'lost':
      return {
        topic: 'child.failed',
        severity: 'warning',
        title: `${name} was lost when the app restarted`,
      }
    // Work that is still running has not ended: a row for it would announce an end that never
    // happened. Named rather than defaulted, so a new status is a compile-time decision here.
    case 'running':
      return null
  }
}

export function createWorkNotifications(deps: {
  journal: NotificationJournal
  lane: OrderedLane
  lookupSession: LookupSession
  /** The session's RUNNING work — the owner filter `WorkRegistry.list` already applies. */
  runningWork: (owner: { userId: string; sessionId: string }) => readonly WorkRecord[]
}): WorkNotifications {
  const { journal, lane, lookupSession } = deps
  const endedTerminals = new Set<string>()

  const rememberTerminal = (terminalId: string) => {
    endedTerminals.add(terminalId)
    if (endedTerminals.size > ENDED_TERMINALS_CAP) {
      const oldest = endedTerminals.values().next().value
      if (oldest !== undefined) endedTerminals.delete(oldest)
    }
  }

  const recordFor = async (
    userId: string,
    sessionId: string,
    fact: Omit<RaiseFact, 'origin' | 'actions' | 'body'> & { body?: string },
    resource: { kind: string; id: string; label: string },
  ) => {
    const session =
      (await lookupSession(userId, sessionId).catch(() => null)) ?? unknownSession(sessionId)
    journal.record(userId, {
      ...fact,
      body: fact.body?.trim() || session.title,
      origin: resourceOrigin(session, resource.kind, resource.id, resource.label),
      actions: [openChatAction(session)],
    })
  }

  return {
    ended(record, ending) {
      if (record.terminalId) rememberTerminal(record.terminalId)
      if (record.kind === 'subagent') return
      // A monitor's end is its wake unless someone stopped it; a restart's loss wakes nobody here.
      const wakes =
        ending.wakesAgent || (record.kind === 'monitor' && record.status !== 'cancelled')
      if (wakes && record.status !== 'lost') return
      const shape = describe(record)
      if (!shape) return
      lane.run(() =>
        recordFor(
          record.userId,
          record.sessionId,
          {
            key: workKey(record.id),
            ...shape,
            category: record.kind === 'job' ? 'terminal' : 'agent',
            body: record.label,
            ...(record.endedAt ? { occurredAt: Date.parse(record.endedAt) } : {}),
          },
          { kind: 'work', id: record.id, label: KIND_NAME[record.kind] },
        ),
      )
    },
    terminalLifecycle(userId, sessionId, event) {
      if (event.type !== 'terminal.finished' || event.interactive || event.wakesAgent) return
      if (endedTerminals.has(event.terminalId)) return
      const owner = { userId, sessionId }
      if (deps.runningWork(owner).some((record) => record.terminalId === event.terminalId)) return
      const outcome = terminalOutcome(event)
      lane.run(() =>
        recordFor(
          userId,
          sessionId,
          {
            key: terminalKey(event.terminalId),
            topic: 'terminal.finished',
            category: 'terminal',
            severity: outcome.severity,
            title: outcome.title,
            body: event.command,
            ...(event.finishedAt !== undefined ? { occurredAt: event.finishedAt } : {}),
          },
          { kind: 'terminal', id: event.terminalId, label: 'Terminal' },
        ),
      )
    },
  }
}

// A process stopped by a signal exits 128+N: SIGHUP, SIGINT (a closed pane), SIGKILL, SIGTERM.
const STOP_SIGNAL_EXITS = new Set([129, 130, 137, 143])

/**
 * A finished terminal in plain words. A stop is not a failure: an explicit close carries its
 * reason (`timeout 60 s`), and a stop signal from elsewhere (^C in the pane) reads as an
 * interruption. Only an unexpected non-zero exit is an error.
 */
export function terminalOutcome(event: { exitCode: number; stopped?: true; stopReason?: string }): {
  severity: 'info' | 'error' | 'success'
  title: string
} {
  if (event.stopped)
    return {
      severity: 'info',
      title: event.stopReason
        ? `Background terminal stopped (${event.stopReason})`
        : 'Background terminal stopped',
    }
  if (event.exitCode === 0) return { severity: 'success', title: 'Background terminal finished' }
  if (STOP_SIGNAL_EXITS.has(event.exitCode))
    return {
      severity: 'info',
      title: `Background terminal interrupted (exit ${event.exitCode})`,
    }
  return { severity: 'error', title: `Background terminal exited with code ${event.exitCode}` }
}
