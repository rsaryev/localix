import type {
  EventTraceStep,
  NotificationAction,
  NotificationEntry,
  NotificationOrigin,
  TraceAttributeValue,
} from './types'

export const EVENT_TITLE_MAX = 240
export const EVENT_MESSAGE_MAX = 4_000
export const EVENT_TRACE_MAX = 12
export const EVENT_TRACE_ATTRIBUTES_MAX = 24
const EVENT_LABEL_MAX = 160
const TRACE_KIND_MAX = 160
const TRACE_SUMMARY_MAX = 500
const TRACE_ATTRIBUTE_KEY_MAX = 80
const TRACE_ATTRIBUTE_VALUE_MAX = 500

function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`
}

function sanitizeOrigin(origin: NotificationOrigin): NotificationOrigin {
  const label = origin.label ? bounded(origin.label, EVENT_LABEL_MAX) : undefined
  return label ? { ...origin, label } : { ...origin, label: undefined }
}

function sanitizeAttribute(value: TraceAttributeValue): TraceAttributeValue | undefined {
  if (typeof value === 'string') return bounded(value, TRACE_ATTRIBUTE_VALUE_MAX)
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  return value
}

function sanitizeTraceStep(step: EventTraceStep): EventTraceStep {
  const attributes = step.attributes
    ? Object.fromEntries(
        Object.entries(step.attributes)
          .slice(0, EVENT_TRACE_ATTRIBUTES_MAX)
          .flatMap(([key, value]) => {
            const sanitized = sanitizeAttribute(value)
            return sanitized === undefined
              ? []
              : [[bounded(key, TRACE_ATTRIBUTE_KEY_MAX), sanitized] as const]
          }),
      )
    : undefined
  return {
    ...step,
    kind: bounded(step.kind, TRACE_KIND_MAX),
    summary: bounded(step.summary, TRACE_SUMMARY_MAX),
    origin: sanitizeOrigin(step.origin),
    attributes: attributes && Object.keys(attributes).length > 0 ? attributes : undefined,
  }
}

function sanitizeAction(action: NotificationAction): NotificationAction {
  return { ...action, label: bounded(action.label, EVENT_LABEL_MAX) }
}

/** Central bounded journal representation; navigation identities remain exact. */
export function sanitizeNotificationEntry(entry: NotificationEntry): NotificationEntry {
  return {
    ...entry,
    title: bounded(entry.title, EVENT_TITLE_MAX),
    message: entry.message ? bounded(entry.message, EVENT_MESSAGE_MAX) : undefined,
    origin: sanitizeOrigin(entry.origin),
    actions: entry.actions?.map(sanitizeAction),
    trace: entry.trace?.slice(-EVENT_TRACE_MAX).map(sanitizeTraceStep),
  }
}
