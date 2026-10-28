/**
 * ONE QUEUED TURN — something that came into a session and has not been answered yet.
 *
 * A tagged union, because the kinds differ in what they carry and in everything the queue does
 * with them (`kinds.ts` holds that table). It used to be one bag of fifteen optional fields read
 * through five predicates spread over four files, and the predicates had to agree: a slash
 * command carrying a ticket, or a child's report without its facts, could be built, and a source
 * added to one predicate and not another changed what the queue promised without changing what
 * it did.
 *
 *   person   the person's words, sent while the session was busy
 *   command  a slash command sent while busy, kept whole until its turn (`QueuedCommand`)
 *   event    a machine wake: a loop, a job, a hook, a mini app, a delegator's message, …
 *   report   a delegated child's report to the agent who delegated
 *   ticket   execution intent: one agent answers (`AgentTurnTicket`)
 *
 * What every kind shares is the envelope. The delivery attributes (bindings, surface, mini apps, …)
 * are shared too: the delivery stage reads them alike, whoever produced them.
 */
import type { ToolSurface } from '@localixai/agent/agents'

import type { DelegatedReport, MessageBinding, WakeSource } from '../../contracts'
import type { AgentTurnTicket } from '../agent-turn-ticket'
import type { RunExecutionContext } from '../execution-context'
import type { EnqueueParams, QueuedCommand } from '../wake-queue-contracts'

interface Envelope {
  userId: string
  /** What the delivered turn's row says. */
  content: string
  queuedAt: string
  /** True = hidden from the UI transcript (NOT from the model). */
  internal: boolean
  /** The durable row's kind and the composer's: the person's visible words, or anything else. */
  kind: 'user' | 'wake'
  /** Provenance tag (loop / hook / subagent / …) — orthogonal to `internal`. */
  source?: WakeSource
  /** Originating optimistic UI row; correlation only, never a durable message id. */
  clientMessageId?: string
  extraDisabledTools?: string[]
  /** Mini apps whose tools the answering turn carries; lands on the turn's row. */
  miniApps?: string[]
  bindings?: MessageBinding[]
  /** The client surface the words were sent from (the workbench catalog), never authority. */
  toolSurface?: ToolSurface
  /** Trusted authority inherited from the run that scheduled this wake. */
  executionContext?: RunExecutionContext
  /**
   * The band this entry was claimed in, when it was claimed together with others. Sticky until
   * the band is acknowledged, and durable in its own column (not this payload), so a delivery
   * interrupted by a crash replays with exactly the entries — and the transcript row — it had.
   */
  batch?: string
  /**
   * Why its delivery failed every retry (`dead-letter.ts`). A failed entry is off the head: no
   * drain or running turn takes it until the person retries it. Durable in its own column too.
   */
  failure?: string
}

export interface PersonTurn extends Envelope {
  entry: 'person'
}

export interface CommandTurn extends Envelope {
  entry: 'command'
  command: QueuedCommand
}

export interface EventTurn extends Envelope {
  entry: 'event'
  /** Delivered together with the other queued events of this key (`WakeRequest.coalesce`). */
  coalesce?: string
}

export interface ReportTurn extends Envelope {
  entry: 'report'
  report: DelegatedReport
}

export interface TicketTurn extends Envelope {
  entry: 'ticket'
  agentTurn: AgentTurnTicket
}

export type PendingTurn = PersonTurn | CommandTurn | EventTurn | ReportTurn | TicketTurn
export type EntryKind = PendingTurn['entry']

/** The ticket a turn carries, when it is one. */
export const ticketOf = (turn: PendingTurn): AgentTurnTicket | undefined =>
  turn.entry === 'ticket' ? turn.agentTurn : undefined

/** The queued command a turn carries, when it is one. */
export const commandOf = (turn: PendingTurn): QueuedCommand | undefined =>
  turn.entry === 'command' ? turn.command : undefined

/**
 * Does this turn fix the run it opens — its authority, its address or its tools — so that no
 * neighbour may be delivered in it, and it may not join a run someone else opened?
 *
 * The client SURFACE is not on this list. Every send from the app carries one (the workbench
 * catalog), and when it was, no person's message typed into a busy session could ever reach the
 * running model or join the message before it: the queue promised "next tool" for an interjection
 * it would never deliver. A surface is compared instead (`sameSurface`).
 */
export const fixesExecution = (turn: PendingTurn): boolean =>
  turn.entry === 'ticket' ||
  turn.entry === 'command' ||
  turn.executionContext != null ||
  Boolean(turn.extraDisabledTools?.length)

/** A client surface as a comparable key: its capabilities and catalogs, in a fixed order. */
export function surfaceKey(surface: ToolSurface | undefined): string {
  if (!surface) return ''
  const capabilities = [...surface.capabilities].sort().join(',')
  const catalogs = Object.entries(surface.catalogs ?? {})
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([name, id]) => `${name}=${id}`)
    .join(',')
  return `${capabilities}|${catalogs}`
}

/** Were two turns sent from the same client surface (or both from none)? */
export const sameSurface = (a: ToolSurface | undefined, b: ToolSurface | undefined): boolean =>
  surfaceKey(a) === surfaceKey(b)

/**
 * Which kind of entry an admission makes — the one place the producer's fields decide it. A
 * VISIBLE turn is the person's words: a machine wake is always hidden from the transcript.
 */
function entryKindOf(params: EnqueueParams): EntryKind {
  if (params.agentTurn) return 'ticket'
  if (params.command) return 'command'
  if (params.report) return 'report'
  if (
    params.person ||
    params.internal === false ||
    params.source === 'user-busy' ||
    params.source === 'user-steer'
  )
    return 'person'
  return 'event'
}

/** The entry an admission queues. */
export function createPendingTurn(params: EnqueueParams, queuedAt: string): PendingTurn {
  const internal = params.internal ?? true
  const envelope: Envelope = {
    userId: params.userId,
    content: params.content,
    queuedAt,
    internal,
    kind: internal ? 'wake' : 'user',
    ...(params.source ? { source: params.source } : {}),
    ...(params.clientMessageId ? { clientMessageId: params.clientMessageId } : {}),
    ...(params.extraDisabledTools ? { extraDisabledTools: params.extraDisabledTools } : {}),
    ...(params.miniApps?.length ? { miniApps: params.miniApps } : {}),
    ...(params.bindings ? { bindings: params.bindings } : {}),
    ...(params.toolSurface ? { toolSurface: params.toolSurface } : {}),
    ...(params.executionContext ? { executionContext: params.executionContext } : {}),
  }
  switch (entryKindOf(params)) {
    case 'ticket':
      return { ...envelope, entry: 'ticket', agentTurn: params.agentTurn! }
    case 'command':
      return { ...envelope, entry: 'command', command: params.command! }
    case 'report':
      return { ...envelope, entry: 'report', report: params.report! }
    case 'person':
      return { ...envelope, entry: 'person' }
    case 'event':
      return {
        ...envelope,
        entry: 'event',
        ...(params.coalesce ? { coalesce: params.coalesce } : {}),
      }
  }
}

/**
 * A durable row's payload as an entry — TOLERANT of rows written before entries were tagged.
 *
 * Those rows carry the old bag of fields and no `entry`; they are classified by the fields that
 * made each kind, so a queue that survived an upgrade drains exactly as it would have. A legacy
 * report carries only its worded text, not its facts, so it is delivered as the plain wake it was.
 */
export function readPendingTurn(payload: unknown, batch?: string, failure?: string): PendingTurn {
  const row = payload as Partial<Envelope> & {
    entry?: EntryKind
    agentTurn?: AgentTurnTicket
    command?: QueuedCommand
  }
  const sticky = { ...(batch ? { batch } : {}), ...(failure ? { failure } : {}) }
  if (row.entry) return { ...(row as PendingTurn), ...sticky }
  const envelope = row as Envelope
  if (row.agentTurn) return { ...envelope, entry: 'ticket', agentTurn: row.agentTurn, ...sticky }
  if (row.command) return { ...envelope, entry: 'command', command: row.command, ...sticky }
  if (row.kind === 'user' || row.source === 'user-busy' || row.source === 'user-steer')
    return { ...envelope, entry: 'person', ...sticky }
  return { ...envelope, entry: 'event', ...sticky }
}
