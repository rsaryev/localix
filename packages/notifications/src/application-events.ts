import type { NotificationEnvelope, NotificationSeverity } from './contracts'

/**
 * WHAT THE APP ITSELF REPORTS, as opposed to what an agent run did.
 *
 * Split from `events.ts`, where both lived, because they answer different questions and only
 * one of them has a vocabulary: an agent envelope is built from a TRIGGER union that grows a
 * member per lifecycle fact the runtime learns to observe, while an application envelope is
 * built from a severity and a sentence. Keeping them together meant every reader of "how is a
 * run reported" scrolled past "how is a failed copy reported" first.
 *
 * Both still join the same durable journal and the same policy, which is the point of having
 * them at all: no surface has to invent an ephemeral error path of its own.
 */

const APPLICATION_TTL_MS = 10 * 60_000
const DEFAULT_DEDUPE_MS = 30_000
/** How long a standing condition stays one row rather than becoming a second one. */
const CONDITION_TTL_MS = 60 * 60_000

/**
 * Its own counter, not the agent builder's.
 *
 * The two cannot collide: every id here is prefixed by a dedupe key beginning `application.`,
 * which no agent topic produces. Sharing one counter across modules would be a coupling that
 * buys nothing but an import.
 */
let sequence = 0

/**
 * Envelope for an APPLICATION-level notification — something the app itself reports (a failed
 * request, a copy that did not work).
 *
 * Display text is presentation, not identity, so the dedupe key is per-invocation: two distinct
 * errors that happen to share a message must not collapse into one.
 */
export function applicationNotificationEnvelope(
  severity: NotificationSeverity,
  title: string,
  body?: string,
  occurredAt = Date.now(),
): NotificationEnvelope {
  sequence += 1
  const dedupeKey = `application.notification:${occurredAt.toString(36)}:${sequence.toString(36)}`
  return {
    id: `${dedupeKey}:${occurredAt.toString(36)}`,
    occurredAt,
    event: {
      topic: 'application.notification',
      severity,
      title,
      body,
      source: { kind: 'application' },
      persistence: 'durable',
      actions: [],
      dedupeKey,
      dedupeWindowMs: DEFAULT_DEDUPE_MS,
      ttlMs: APPLICATION_TTL_MS,
    },
  }
}

/**
 * Envelope for a standing CONDITION — something that is wrong now and stays wrong until someone
 * fixes it (a board file that will not validate, a database that will not connect, a config the app
 * cannot read).
 *
 * The difference from {@link applicationNotificationEnvelope} is identity, and it is the whole
 * point: a failed copy is an event that happened once, while a broken file is a fact that is
 * republished on every save, every watch tick and every reopen. With a per-invocation key those
 * republishes are twenty rows saying the same thing; with a caller-supplied key they are one row
 * with an occurrence count, which is what a notification centre is for.
 *
 * The caller owns the key and must derive it from the CONDITION (subject + what is wrong), never
 * from the moment — otherwise this is the previous behaviour with extra steps.
 *
 * Republishing an unchanged condition is IDEMPOTENT, not counted: the row keeps its identity, its
 * position and the user's read state, and no occurrence tally advances. That is the intended
 * behaviour — a fact that is still true has not happened twice.
 */
export function applicationConditionEnvelope(
  severity: NotificationSeverity,
  title: string,
  body: string | undefined,
  conditionKey: string,
  occurredAt = Date.now(),
): NotificationEnvelope {
  const dedupeKey = `application.condition:${conditionKey}`
  return {
    id: dedupeKey,
    occurredAt,
    event: {
      topic: 'application.notification',
      severity,
      title,
      body,
      source: { kind: 'application' },
      persistence: 'durable',
      actions: [],
      dedupeKey,
      dedupeWindowMs: CONDITION_TTL_MS,
      ttlMs: CONDITION_TTL_MS,
    },
  }
}
