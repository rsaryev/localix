import type { NotificationTopic } from '@localixai/notifications'

/** Severity shared by the notification publisher and durable center. */
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'
export type NotificationCategory = 'human-input' | 'agent' | 'terminal' | 'system'
export type NotificationActionKind = 'navigate' | 'invoke' | 'callback'
/** Serializable registry key; command ownership lives outside the Event Center UI. */
export type NotificationCommand = string

export interface SessionCoordinates {
  sessionId: string
  projectId: string | null
}

export interface SessionTarget extends SessionCoordinates {
  kind: 'session'
}

/** Typed provenance. It is data, never reconstructed from display text. */
export type NotificationOrigin =
  | (SessionTarget & { label?: string })
  | (SessionCoordinates & {
      kind: 'resource'
      resourceKind: string
      resourceId: string
      label?: string
    })
  | { kind: 'application'; label?: string }

export interface NotificationTarget extends SessionTarget {
  /** Lets the destination emphasize the pending interaction instead of merely opening the chat. */
  focus?: 'interaction'
}

export type TraceAttributeValue = string | number | boolean | null

/** One domain-agnostic causal step captured before an event was emitted. */
export interface EventTraceStep {
  id: string
  ts: number
  /** Correlates start/result/error steps belonging to one operation. */
  traceId?: string
  kind: string
  summary: string
  origin: NotificationOrigin
  phase?: 'started' | 'succeeded' | 'failed' | 'cancelled' | 'event'
  durationMs?: number
  attributes?: Record<string, TraceAttributeValue>
}

/**
 * An event action. Domain actions are serializable and survive reload; callback
 * actions (Undo, Review, etc.) remain live only for the current app process.
 */
export interface NotificationAction {
  id: string
  label: string
  kind: NotificationActionKind
  command?: NotificationCommand
  target?: NotificationTarget
  /**
   * A `localix://` destination for a `navigate` action that is not a conversation — a settings
   * section, a sign-in. Recovery actions on conditions and failed runs carry one; without it the
   * button had nothing to open and did nothing.
   */
  uri?: string
  requestId?: string
  /** The run a `retry_run` command was offered for; Retry refuses once it is no longer the latest. */
  runId?: string
  onClick?: () => void | Promise<void>
  available: boolean
  /**
   * When a callback stops meaning what it meant. A toast's "Undo" or "Force push" was a choice
   * offered for the few seconds the toast was on screen; on a durable row it stayed clickable for
   * hours, long after the state it would act on had moved — an Undo that reverted a later change.
   */
  expiresAt?: number
}

/**
 * One row of the Event Center: the server journal's `InboxEntry` in the shape the UI renders
 * (`inboxMapping.ts`), with this window's process-local callbacks merged in (`overlay.ts`).
 */
export interface NotificationEntry {
  /** The journal key — the fact's identity, derived from what it is about. */
  id: string
  topic: NotificationTopic
  category: NotificationCategory
  severity: NotificationSeverity
  /** Short headline. */
  title: string
  /** Optional longer body. */
  message?: string
  /** Optional action buttons. */
  actions?: NotificationAction[]
  /** Structured source of the event and its optional human-readable producer. */
  origin: NotificationOrigin
  /** Domain-agnostic causal trace captured when this event was recorded. */
  trace?: EventTraceStep[]
  /**
   * A standing condition ("this file does not validate"): true until settled, reopened when it
   * comes back, and never removed by "Clear history" while open.
   */
  condition?: boolean
  /** Set when a formerly actionable lifecycle event (notably HITL) settles. */
  resolvedAt?: number
  /** Repeated application events are coalesced into one quiet row. */
  occurrenceCount?: number
  firstSeenAt?: number
  lastSeenAt?: number
  /** Creation time (epoch ms). */
  ts: number
  /**
   * Whether the user has seen this entry. Set when the producing surface was on screen, or by an
   * explicit mark-read; opening the centre does NOT clear it on its own.
   */
  read: boolean
}

/** Fields a caller supplies when pushing; id/ts/read are filled by the store. */
export type NotificationInput = Omit<NotificationEntry, 'id' | 'ts' | 'read'> &
  Partial<Pick<NotificationEntry, 'id' | 'ts' | 'read'>>
