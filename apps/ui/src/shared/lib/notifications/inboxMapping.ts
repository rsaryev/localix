import type {
  InboxAction,
  InboxEntry,
  InboxTraceStep,
  RaiseFact,
} from '@localixai/api/notification-contracts'

import type { EventTraceStep, NotificationAction, NotificationEntry } from './types'

/**
 * THE TWO SHAPES OF ONE ROW: the server journal's `InboxEntry` and the `NotificationEntry` the
 * Event Center renders. Every conversion between them lives here, so the renderer never learns the
 * wire vocabulary (`body`, `state`, `readAt`) and the wire never carries what cannot survive it (a
 * callback).
 */

/** The server's cap on a key (`clientJournalOpsSchema`); a longer one fails the whole batch. */
const KEY_MAX = 400
const KEY_PART_MAX = 180

/** FNV-1a, twice with different seeds: a stable, dependency-free fingerprint for an overlong key. */
function fingerprint(value: string): string {
  let left = 0x811c9dc5
  let right = 0x01000193
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    left = Math.imul(left ^ code, 0x01000193) >>> 0
    right = Math.imul(right ^ code, 0x811c9dc5) >>> 0
  }
  return `${left.toString(36)}${right.toString(36)}`
}

/**
 * Keep a key within the wire cap WITHOUT breaking prefix settling: an overlong part is shortened
 * deterministically, so the prefix a producer settles by is the same string its keys start with.
 * A problem report's key embeds every problem it lists, which is how a large report once exceeded
 * the cap and would have been rejected together with every op batched beside it.
 */
export function boundedKeyPart(part: string): string {
  return part.length <= KEY_PART_MAX
    ? part
    : `${part.slice(0, KEY_PART_MAX - 16)}#${fingerprint(part)}`
}

export function boundedKey(key: string): string {
  return key.length <= KEY_MAX ? key : `${key.slice(0, KEY_MAX - 16)}#${fingerprint(key)}`
}

export function entryFromInbox(row: InboxEntry): NotificationEntry {
  return {
    id: row.key,
    topic: row.topic,
    category: row.category,
    severity: row.severity,
    title: row.title,
    message: row.body,
    origin: row.origin,
    actions: row.actions?.map((action) => ({ ...action })),
    trace: row.trace,
    condition: row.condition,
    resolvedAt: row.state === 'settled' ? (row.settledAt ?? row.lastSeenAt) : undefined,
    occurrenceCount: row.occurrenceCount,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    ts: row.createdAt,
    read: row.readAt != null,
  }
}

/** Only what can be replayed crosses the wire; a callback stays in this window (`overlay.ts`). */
function serializableAction(action: NotificationAction): InboxAction | null {
  if (action.kind === 'callback' || action.onClick) return null
  return {
    id: action.id,
    label: action.label,
    kind: action.kind,
    ...(action.command ? { command: action.command } : {}),
    ...(action.target ? { target: action.target } : {}),
    ...(action.uri ? { uri: action.uri } : {}),
    ...(action.requestId ? { requestId: action.requestId } : {}),
    ...(action.runId ? { runId: action.runId } : {}),
    available: action.available,
  }
}

function wireTraceStep(step: EventTraceStep): InboxTraceStep {
  return {
    ...step,
    id: step.id.slice(0, 120),
    ...(step.traceId ? { traceId: step.traceId.slice(0, 200) } : {}),
  }
}

/** The raise op for a row this client knows about; `entry` is already sanitized. */
export function factFromEntry(
  entry: NotificationEntry,
  options: { coalesce?: boolean; occurredAt: number },
): RaiseFact {
  const actions = (entry.actions ?? [])
    .map(serializableAction)
    .filter((action): action is InboxAction => action !== null)
  return {
    key: entry.id,
    topic: entry.topic,
    category: entry.category,
    severity: entry.severity,
    title: entry.title,
    ...(entry.message ? { body: entry.message } : {}),
    origin: entry.origin,
    ...(actions.length ? { actions } : {}),
    ...(entry.trace?.length ? { trace: entry.trace.map(wireTraceStep) } : {}),
    ...(entry.condition ? { condition: true } : {}),
    ...(options.coalesce ? { coalesce: true } : {}),
    ...(entry.read ? { seen: true } : {}),
    occurredAt: options.occurredAt,
  }
}
