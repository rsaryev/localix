import type { NotificationCategory, NotificationEntry, NotificationSeverity } from './types'
import { notificationCommandRevision } from './commandRegistry'
import { eventNeedsAction } from './actionability'

export { eventNeedsAction, retainActionableEvents } from './actionability'
export { eventSignalKey, highestUnreadSeverity } from './signal'

export type EventScope = 'all' | 'session' | 'action' | 'unread'
export type EventCategoryFilter = 'all' | NotificationCategory
export type EventSeverityFilter = 'all' | NotificationSeverity
export type EventTimeFilter = 'all' | 'hour' | 'day' | 'week'

export interface EventFilters {
  scope: EventScope
  category: EventCategoryFilter
  severity: EventSeverityFilter
  time: EventTimeFilter
  query: string
  currentSessionId?: string | null
}

interface QueryTerm {
  key?: string
  value: string
  exclude: boolean
}

const TIME_WINDOWS: Record<Exclude<EventTimeFilter, 'all'>, number> = {
  hour: 60 * 60_000,
  day: 24 * 60 * 60_000,
  week: 7 * 24 * 60 * 60_000,
}

function queryTerms(query: string): QueryTerm[] {
  const tokens = query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
  return tokens
    .map((raw): QueryTerm | null => {
      const exclude = raw.startsWith('-') || raw.startsWith('−')
      const token = (exclude ? raw.slice(1) : raw).replaceAll('"', '').trim()
      if (!token) return null
      const separator = token.indexOf(':')
      return separator > 0
        ? {
            key: token.slice(0, separator).toLocaleLowerCase(),
            value: token.slice(separator + 1).toLocaleLowerCase(),
            exclude,
          }
        : { value: token.toLocaleLowerCase(), exclude }
    })
    .filter((term): term is QueryTerm => term !== null && term.value.length > 0)
}

function valuesOf(entry: NotificationEntry): string[] {
  const origin = entry.origin
  const traceValues = (entry.trace ?? []).flatMap((step) => [
    step.kind,
    step.summary,
    step.traceId,
    step.phase,
    step.origin.kind === 'resource' ? step.origin.resourceKind : undefined,
    step.origin.kind === 'resource' ? step.origin.resourceId : undefined,
    ...Object.entries(step.attributes ?? {}).flatMap(([key, value]) => [key, String(value)]),
  ])
  return [
    entry.title,
    entry.message,
    origin.label,
    origin.kind,
    origin.kind !== 'application' ? origin.sessionId : undefined,
    origin.kind === 'resource' ? origin.resourceKind : undefined,
    origin.kind === 'resource' ? origin.resourceId : undefined,
    entry.topic,
    entry.category,
    entry.severity,
    ...traceValues,
  ]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.toLocaleLowerCase())
}

function matchesTerm(
  entry: NotificationEntry,
  term: QueryTerm,
  values: readonly string[],
  commandRevision: number,
): boolean {
  const origin = entry.origin
  const includes = (value: string | undefined) =>
    value?.toLocaleLowerCase().includes(term.value) ?? false
  switch (term.key) {
    case undefined:
      return values.some((value) => value.includes(term.value))
    case 'level':
    case 'severity':
      return includes(entry.severity)
    case 'type':
    case 'category':
      return includes(entry.category) || includes(entry.topic)
    case 'session':
      return origin.kind !== 'application' && includes(origin.sessionId)
    case 'project':
      return origin.kind !== 'application' && includes(origin.projectId ?? undefined)
    case 'resource':
      return (
        origin.kind === 'resource' && (includes(origin.resourceKind) || includes(origin.resourceId))
      )
    case 'source':
      return (
        includes(origin.kind) ||
        (origin.kind === 'resource' && includes(origin.resourceKind)) ||
        includes(origin.label)
      )
    case 'topic':
      return includes(entry.topic)
    case 'trace':
      return (entry.trace ?? []).some((step) =>
        [step.kind, step.summary, step.traceId].some(includes),
      )
    case 'phase':
      return (entry.trace ?? []).some((step) => includes(step.phase))
    case 'action':
      return (entry.actions ?? []).some(
        (action) =>
          includes(action.id) ||
          includes(action.label) ||
          includes(action.kind) ||
          includes(action.command),
      )
    case 'has':
      return term.value === 'trace'
        ? (entry.trace?.length ?? 0) > 0
        : term.value === 'action'
          ? (entry.actions?.length ?? 0) > 0
          : term.value === 'session'
            ? origin.kind !== 'application'
            : term.value === 'resource'
              ? origin.kind === 'resource'
              : false
    case 'is':
      return term.value === 'unread'
        ? !entry.read
        : term.value === 'read'
          ? entry.read
          : term.value === 'action'
            ? eventNeedsAction(entry, commandRevision)
            : term.value === 'resolved'
              ? entry.resolvedAt != null
              : term.value === 'repeated'
                ? (entry.occurrenceCount ?? 1) > 1
                : term.value === 'failed'
                  ? entry.severity === 'error' ||
                    (entry.trace ?? []).some((step) => step.phase === 'failed')
                  : false
    default:
      return values.some((value) => value.includes(term.value))
  }
}

export function filterEvents(
  entries: readonly NotificationEntry[],
  filters: EventFilters,
  now = Date.now(),
  commandRevision = notificationCommandRevision(),
): NotificationEntry[] {
  const terms = queryTerms(filters.query)
  return entries.filter((entry) => {
    if (
      filters.scope === 'session' &&
      (entry.origin.kind === 'application' || entry.origin.sessionId !== filters.currentSessionId)
    ) {
      return false
    }
    if (filters.scope === 'action' && !eventNeedsAction(entry, commandRevision)) return false
    if (filters.scope === 'unread' && entry.read) return false
    if (filters.category !== 'all' && entry.category !== filters.category) return false
    if (filters.severity !== 'all' && entry.severity !== filters.severity) return false
    if (
      filters.time !== 'all' &&
      now - (entry.lastSeenAt ?? entry.ts) > TIME_WINDOWS[filters.time]
    ) {
      return false
    }
    if (terms.length === 0) return true
    const values = valuesOf(entry)
    return terms.every((term) => matchesTerm(entry, term, values, commandRevision) !== term.exclude)
  })
}

function originLine(entry: NotificationEntry): string {
  const origin = entry.origin
  if (origin.kind === 'application') return origin.label ?? 'Application'
  const coordinates = [origin.projectId, origin.sessionId].filter(Boolean).join(' / ')
  if (origin.kind === 'session')
    return origin.label ? `${coordinates} (${origin.label})` : coordinates
  const resource = `${origin.resourceKind}:${origin.resourceId}`
  return `${coordinates} / ${resource}${origin.label ? ` (${origin.label})` : ''}`
}

/** Stable, plain-text incident context for support, issue reports and hand-off. */
export function formatEventForClipboard(entry: NotificationEntry): string {
  const lines = [
    entry.title,
    `Severity: ${entry.severity}`,
    `Category: ${entry.category}`,
    `Topic: ${entry.topic}`,
    `Time: ${new Date(entry.ts).toISOString()}`,
    `Status: ${entry.resolvedAt ? 'resolved' : entry.read ? 'read' : 'unread'}`,
    `Origin: ${originLine(entry)}`,
  ]
  if ((entry.occurrenceCount ?? 1) > 1) {
    lines.push(`Occurrences: ${entry.occurrenceCount}`)
  }
  if (entry.message) lines.push('', entry.message)
  const availableActions = (entry.actions ?? []).filter((action) => action.available)
  if (availableActions.length > 0) {
    lines.push(
      '',
      'Actions:',
      ...availableActions.map(
        (action) =>
          `- ${action.label} [${action.kind}${action.command ? `:${action.command}` : ''}]`,
      ),
    )
  }
  const trace = compactClipboardTrace(entry.trace ?? [])
  if (trace.length > 0) {
    lines.push('', 'Trace:')
    for (const step of trace) {
      const phase = step.phase ? ` [${step.phase}]` : ''
      const duration =
        step.durationMs == null ? '' : ` (${Math.max(0, Math.round(step.durationMs))}ms)`
      lines.push(
        `- ${new Date(step.ts).toISOString()}${phase} ${step.kind}: ${step.summary}${duration}`,
      )
      if (step.origin.kind === 'resource') {
        lines.push(`  Resource: ${step.origin.resourceKind}:${step.origin.resourceId}`)
      }
      const attributes = Object.entries(step.attributes ?? {})
      if (attributes.length > 0) {
        lines.push(
          `  Data: ${attributes.map(([key, value]) => `${key}=${String(value)}`).join(', ')}`,
        )
      }
    }
  }
  return lines.join('\n')
}

function compactClipboardTrace(trace: NonNullable<NotificationEntry['trace']>) {
  return trace.slice(-8)
}
