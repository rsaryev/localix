import { z } from 'zod'
import {
  NOTIFICATION_TOPICS,
  type NotificationCategory,
  type NotificationSeverity,
  type NotificationTopic,
} from '@localixai/notifications'

/**
 * THE NOTIFICATION JOURNAL'S VOCABULARY — one owner for the server that records facts and the
 * browser that shows them (exported as `@localixai/api/notification-contracts`).
 *
 * The journal is the single source of truth for everything the Event Center shows. It used to be
 * the browser's `localStorage`: the UI derived rows from stream frames, so a closed window learned
 * nothing, two windows disagreed, and the history lived outside `~/.localix`. Now the fact is
 * recorded where it happens — by the server for what it knows, by the client (through the same
 * write path) for what only it knows — as an append-only event log, one inbox row per subject.
 */

export type InboxCategory = NotificationCategory

/** Typed provenance. It is data, never reconstructed from display text. */
export type InboxOrigin =
  | { kind: 'session'; sessionId: string; projectId: string | null; label?: string }
  | {
      kind: 'resource'
      sessionId: string
      projectId: string | null
      resourceKind: string
      resourceId: string
      label?: string
    }
  | { kind: 'application'; label?: string }

export interface InboxTarget {
  kind: 'session'
  sessionId: string
  projectId: string | null
  /** Lets the destination emphasize the pending interaction instead of merely opening the chat. */
  focus?: 'interaction'
}

/**
 * A SERIALIZABLE action — a callback cannot cross the wire or survive a restart: a navigation (a
 * chat `target`, or a `localix://` `uri`, `recovery.ts`) or a command a registered owner runs.
 */
export interface InboxAction {
  id: string
  label: string
  kind: 'navigate' | 'invoke'
  command?: string
  target?: InboxTarget
  requestId?: string
  runId?: string
  uri?: string
  available: boolean
}

export type TraceAttributeValue = string | number | boolean | null

export interface InboxTraceStep {
  id: string
  ts: number
  traceId?: string
  kind: string
  summary: string
  origin: InboxOrigin
  phase?: 'started' | 'succeeded' | 'failed' | 'cancelled' | 'event'
  durationMs?: number
  attributes?: Record<string, TraceAttributeValue>
}

/** Why an open row stopped being open. */
export type SettleReason =
  | 'answered'
  | 'dismissed'
  | 'deferred'
  | 'expired'
  | 'cancelled'
  | 'fixed'
  | 'superseded'
  | 'restart'
  | 'retried'
  | 'completed'

/**
 * Raise a fact. `key` is its IDENTITY — derived from what the fact is about, never from the moment
 * (`hitl:<requestId>`, `run:<messageId>`, `condition:mcp:<server>`). Raising the same key again is
 * how a replay stays one row.
 */
export interface RaiseFact {
  key: string
  topic: NotificationTopic
  category: InboxCategory
  severity: NotificationSeverity
  title: string
  body?: string
  origin: InboxOrigin
  actions?: InboxAction[]
  trace?: InboxTraceStep[]
  /**
   * A standing condition ("this MCP server does not connect"): raised again after it settled, the
   * SAME row reopens with its count advanced — the condition came back. A lifecycle fact (an
   * answered request) is never reopened by a replay.
   */
  condition?: boolean
  /**
   * Anonymous application events (a failed copy) carry a per-invocation key; with `coalesce`, an
   * identical open row seen within five minutes absorbs the repeat as an occurrence.
   */
  coalesce?: boolean
  /** Recorded already read: the person is looking at the source. */
  seen?: boolean
  occurredAt?: number
}

export interface SettleFact {
  /** One row, or every row under a prefix (a subject's superseded conditions). */
  key?: string
  prefix?: string
  /** Under a prefix: the row that is still true. */
  keep?: string
  reason: SettleReason
  occurredAt?: number
}

/** The projected inbox row — what the Event Center renders. */
export interface InboxEntry {
  key: string
  /** Position of this row's latest change in the journal; the sync cursor. */
  seq: number
  topic: NotificationTopic
  category: InboxCategory
  severity: NotificationSeverity
  title: string
  body?: string
  origin: InboxOrigin
  actions?: InboxAction[]
  trace?: InboxTraceStep[]
  condition: boolean
  state: 'open' | 'settled'
  settleReason?: SettleReason
  occurrenceCount: number
  firstSeenAt: number
  lastSeenAt: number
  readAt?: number
  settledAt?: number
  createdAt: number
}

/** One change to one user's inbox, as the socket and the sync endpoint carry it. */
export type InboxChange = { seq: number; entry: InboxEntry } | { seq: number; removedKey: string }

export interface InboxSyncResponse {
  changes: InboxChange[]
  /** The newest position covered; pass it back as `since`. */
  cursor: number
  /**
   * The oldest position the journal still holds. A `since` below it cannot be answered with
   * changes (retention pruned them): the client replaces its copy with a full read.
   */
  floor: number
  /** True when `changes` is the whole inbox rather than a delta. */
  full: boolean
}

/** A client-written batch; `id` makes a retried batch (the outbox) a no-op. */
export type ClientJournalOp =
  | { id: string; op: 'raise'; fact: RaiseFact }
  | { id: string; op: 'settle'; fact: SettleFact }
  | { id: string; op: 'read'; keys: string[] }
  | { id: string; op: 'read_through'; seq: number }
  | { id: string; op: 'remove'; key: string }
  | { id: string; op: 'clear' }

/** Retention: settled-and-read rows leave after this, and the inbox never holds more than the cap. */
export const INBOX_RETENTION_MS = 30 * 24 * 60 * 60_000
export const INBOX_CAP = 5_000
export const COALESCE_WINDOW_MS = 5 * 60_000
export const TITLE_MAX = 240
export const BODY_MAX = 4_000

// ── wire validation (client-written ops) ──────────────────────────────────────────────────────

const origin = z.union([
  z.object({
    kind: z.literal('session'),
    sessionId: z.string().min(1).max(200),
    projectId: z.string().max(200).nullable(),
    label: z.string().max(160).optional(),
  }),
  z.object({
    kind: z.literal('resource'),
    sessionId: z.string().min(1).max(200),
    projectId: z.string().max(200).nullable(),
    resourceKind: z.string().min(1).max(80),
    resourceId: z.string().min(1).max(200),
    label: z.string().max(160).optional(),
  }),
  z.object({ kind: z.literal('application'), label: z.string().max(160).optional() }),
])

const target = z.object({
  kind: z.literal('session'),
  sessionId: z.string().min(1).max(200),
  projectId: z.string().max(200).nullable(),
  focus: z.literal('interaction').optional(),
})

const action = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(160),
  kind: z.enum(['navigate', 'invoke']),
  command: z
    .string()
    .regex(/^[a-z][a-z0-9._-]{0,127}$/u)
    .optional(),
  target: target.optional(),
  requestId: z.string().max(200).optional(),
  runId: z.string().max(200).optional(),
  uri: z.string().startsWith('localix://').max(1_000).optional(),
  available: z.boolean(),
})

const traceStep = z.object({
  id: z.string().max(120),
  ts: z.number(),
  traceId: z.string().max(200).optional(),
  kind: z.string().max(160),
  summary: z.string().max(500),
  origin,
  phase: z.enum(['started', 'succeeded', 'failed', 'cancelled', 'event']).optional(),
  durationMs: z.number().optional(),
  attributes: z
    .record(z.string().max(80), z.union([z.string().max(500), z.number(), z.boolean(), z.null()]))
    .optional(),
})

const raiseFact = z.object({
  key: z.string().min(1).max(400),
  topic: z.enum(NOTIFICATION_TOPICS),
  category: z.enum(['human-input', 'agent', 'terminal', 'system']),
  severity: z.enum(['info', 'success', 'warning', 'error']),
  title: z
    .string()
    .min(1)
    .max(TITLE_MAX * 4),
  body: z
    .string()
    .max(BODY_MAX * 4)
    .optional(),
  origin,
  actions: z.array(action).max(8).optional(),
  trace: z.array(traceStep).max(12).optional(),
  condition: z.boolean().optional(),
  coalesce: z.boolean().optional(),
  seen: z.boolean().optional(),
  occurredAt: z.number().optional(),
})

const settleReason = z.enum([
  'answered',
  'dismissed',
  'deferred',
  'expired',
  'cancelled',
  'fixed',
  'superseded',
  'restart',
  'retried',
  'completed',
])

const settleFact = z
  .object({
    key: z.string().min(1).max(400).optional(),
    prefix: z.string().min(1).max(400).optional(),
    keep: z.string().max(400).optional(),
    reason: settleReason,
    occurredAt: z.number().optional(),
  })
  .refine((fact) => Boolean(fact.key) !== Boolean(fact.prefix), 'key XOR prefix')

const opId = z.string().min(1).max(120)

export const clientJournalOpsSchema = z.object({
  ops: z
    .array(
      z.discriminatedUnion('op', [
        z.object({ id: opId, op: z.literal('raise'), fact: raiseFact }),
        z.object({ id: opId, op: z.literal('settle'), fact: settleFact }),
        z.object({ id: opId, op: z.literal('read'), keys: z.array(z.string().max(400)).max(500) }),
        z.object({ id: opId, op: z.literal('read_through'), seq: z.number().int().min(0) }),
        z.object({ id: opId, op: z.literal('remove'), key: z.string().max(400) }),
        z.object({ id: opId, op: z.literal('clear') }),
      ]),
    )
    .min(1)
    .max(200),
})
