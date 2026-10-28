/**
 * Every topic, once. The type below and the server's wire validation
 * (`apps/api/src/features/notifications/contracts.ts`) both derive from this list, so a topic
 * added here cannot be accepted by one side and rejected by the other.
 *
 * - `user.mentioned`: a board card in a conversation was assigned to the person and waits on them.
 * - `child.stopped`: a sub-agent or job was stopped before it finished — recorded, never an
 *   interruption.
 */
export const NOTIFICATION_TOPICS = [
  'run.completed',
  'run.failed',
  'hitl.required',
  'user.mentioned',
  'child.completed',
  'child.failed',
  'child.stopped',
  'terminal.finished',
  'application.notification',
] as const
export type NotificationTopic = (typeof NOTIFICATION_TOPICS)[number]
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'
export type NotificationPersistence = 'ephemeral' | 'durable'
export type NotificationChannel = 'history' | 'toast' | 'native' | 'terminal'
export type NotificationCondition = 'always' | 'unfocused' | 'off'
export type TerminalNotificationMethod = 'auto' | 'osc9' | 'osc777' | 'bel'

/** Surface-neutral user policy. Hosts own storage and transport construction. */
export interface NotificationPreferences {
  condition: NotificationCondition
  terminalMethod: TerminalNotificationMethod
}

/** Conservative: do not interrupt an active user or guess terminal support. */
export const DEFAULT_NOTIFICATION_PREFERENCES: Readonly<NotificationPreferences> = Object.freeze({
  condition: 'unfocused',
  terminalMethod: 'auto',
})

const CONDITIONS: readonly NotificationCondition[] = ['always', 'unfocused', 'off']
const TERMINAL_METHODS: readonly TerminalNotificationMethod[] = ['auto', 'osc9', 'osc777', 'bel']

/** Validate preferences. Invalid/partial external config falls back field-by-field. */
export function parseNotificationPreferences(raw: unknown): NotificationPreferences {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_NOTIFICATION_PREFERENCES }
  const value = raw as Record<string, unknown>
  return {
    condition: CONDITIONS.includes(value.condition as NotificationCondition)
      ? (value.condition as NotificationCondition)
      : DEFAULT_NOTIFICATION_PREFERENCES.condition,
    terminalMethod: TERMINAL_METHODS.includes(value.terminalMethod as TerminalNotificationMethod)
      ? (value.terminalMethod as TerminalNotificationMethod)
      : DEFAULT_NOTIFICATION_PREFERENCES.terminalMethod,
  }
}

/** Declarative action data. Transports decide which action kinds they can render. */
export type NotificationAction =
  | { id: string; label: string; kind: 'open_deep_link'; uri: string }
  | {
      id: string
      label: string
      kind: 'retry_run'
      sessionId: string
      /**
       * The run that failed. Regenerate always rewrites the session's LATEST reply, so a Retry
       * that does not know which run it was offered for silently rewrites whatever came after.
       */
      runId?: string
    }
  | { id: string; label: string; kind: 'respond_hitl'; sessionId: string; requestId: string }

/**
 * What KIND of fact a notification is, independent of its topic. `human-input` is everything
 * waiting on the person (a blocking request, a mention, a plan to review):
 * interruption policy keys on it, so a new waiting kind interrupts without a topic list to update.
 * The same vocabulary as the server journal's row category.
 */
export type NotificationCategory = 'human-input' | 'agent' | 'terminal' | 'system'

/** Domain payload: no React callback, Tauri command, terminal escape, or Warp type leaks in. */
export interface NotificationEvent {
  topic: NotificationTopic
  /** Absent on events built before categories existed; policy then falls back to the topic. */
  category?: NotificationCategory
  severity: NotificationSeverity
  title: string
  body?: string
  source:
    | {
        kind:
          | 'agent_run'
          | 'agent_hitl'
          | 'agent_child'
          | 'background_terminal'
          /** A conversation asking for the person by name, rather than a run reporting on itself. */
          | 'agent_mention'
        sessionId: string
        projectId?: string | null
        /** Stable domain resource used for trace correlation and inspection. */
        resource?: { kind: string; id: string }
      }
    | { kind: 'application' }
  persistence: NotificationPersistence
  actions: readonly NotificationAction[]
  dedupeKey: string
  dedupeWindowMs: number
  ttlMs: number
}

export interface NotificationEnvelope {
  id: string
  occurredAt: number
  event: NotificationEvent
}

export interface NotificationContext {
  now: number
  /** true/false when a surface knows; unknown delegates focus policy to the transport. */
  focused: boolean | 'unknown'
  /** Whether the user is already looking at this event's source session. */
  sourceVisible: boolean
  /** Quiet mode suppresses interruptive channels, never durable history. */
  quiet: boolean
  /** User interruption preference; absent preserves the conservative default. */
  condition?: NotificationCondition
}

export interface NotificationTransport {
  readonly id: string
  readonly channel: NotificationChannel
  readonly capabilities: ReadonlySet<'actions' | 'deep_links' | 'persistence'>
  deliver(envelope: NotificationEnvelope): void | Promise<void>
}

export interface NotificationDeliveryReport {
  status: 'delivered' | 'deduplicated' | 'expired' | 'suppressed'
  delivered: readonly string[]
  failed: readonly { transportId: string; error: unknown }[]
}
