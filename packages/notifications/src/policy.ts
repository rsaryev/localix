import type { NotificationChannel, NotificationContext, NotificationEnvelope } from './contracts'
import { DEFAULT_NOTIFICATION_PREFERENCES } from './contracts'

/**
 * Which facts are worth interrupting for.
 *
 * Errors, plus everything WAITING on the person rather than reporting to them. That used to be a
 * list of topics (`hitl.required`, `user.mentioned`), and every new way of waiting — a queued
 * question, a presented plan — had to be found and added here by hand or it never interrupted.
 * The producer already says which facts wait on the person: their category is `human-input`. So
 * the policy reads that one field, and a new kind of waiting interrupts by being filed correctly.
 */
function needsReaction(envelope: NotificationEnvelope): boolean {
  const { severity, category } = envelope.event
  return severity === 'error' || category === 'human-input'
}

/** Pure policy decision shared by the web, desktop and terminal composition roots. */
export function notificationChannels(
  envelope: NotificationEnvelope,
  context: NotificationContext,
  available: ReadonlySet<NotificationChannel>,
): ReadonlySet<NotificationChannel> {
  const channels = new Set<NotificationChannel>()
  // Durable history is not an interruption: retain it through focus, quiet mode AND the TTL.
  //
  // The TTL used to gate this too, and that quietly cost the product its main long-autonomy signal.
  // Every notification-producing frame is `replayable` (`session-stream-registry`'s REPLAY_TIER:
  // run.completed, child_session.updated, terminal.finished, hitl.requested),
  // so a completion that happens while nobody is connected is delivered on RECONNECT.
  //
  // This is what makes the TTL below safe to apply to the INTERRUPTION. Every producer now sends
  // the fact's own time, so a replayed frame is judged by when it happened, not when it arrived:
  // `run.completed`/`run.failed` carry `finishedAt`, `hitl.requested` carries `requestedAt`,
  // `terminal.finished` carries `finishedAt`, and `child.*` passes `session.updatedAt`.
  // The chain has three links — the producer sets the field, the contract
  // carries it (apps/api chat/contracts/stream.ts documents why each one exists), and the client
  // handler forwards it into `occurredAt`.
  //
  // The last link is one deletable expression per call site and nothing else observes it, so it is
  // pinned structurally by agent-runtime-notification-time.test.ts. Without the fact's time
  // `agentNotificationEnvelope` stamps `Date.now()`, every replayed frame looks brand new, and a run
  // that finished hours ago raises a banner and rings the bell on reconnect — which is exactly the
  // behaviour that existed before those fields were added.
  //
  // History is exempt from the TTL for the opposite failure. It used to be gated too, and that cost
  // the product its main long-autonomy signal: come back more than RUN_TTL_MS (10 min) after a
  // background sub-agent or job finished and the whole envelope was dropped — no bell entry, no
  // badge, and no second surface to recover from, because the Notification Center is client-side
  // (localStorage) with no server-side history. The user simply never learned their agent finished.
  //
  // Re-delivery is idempotent: the entry id is the event's `dedupeKey` and `addEntry` keeps the
  // existing row, including its read state.
  if (available.has('history') && envelope.event.persistence === 'durable') channels.add('history')

  // Past the TTL, the RECORD stands but the interruption does not — a 10-minute-old completion must
  // not raise a native banner or ring a terminal bell.
  if (context.now - envelope.occurredAt > envelope.event.ttlMs) return channels

  if (context.quiet) return channels
  // The quiet default is deliberately narrower than severity alone: warnings such as budget
  // boundaries remain visible in history, while HITL is the one warning that needs a response.
  if (!needsReaction(envelope)) return channels
  const condition = context.condition ?? DEFAULT_NOTIFICATION_PREFERENCES.condition
  if (condition === 'off') return channels

  // `always` deliberately opts into an interruption even while viewing the source.
  // Unknown focus delegates to the thin transport's last-moment capability check.
  if (condition === 'unfocused' && context.focused === true) return channels

  // The condition gate above decides focus policy. Thin native adapters still
  // recheck focus at delivery time to close races.
  if (available.has('toast')) channels.add('toast')

  if (available.has('native')) channels.add('native')

  // With unknown focus, a terminal emulator remains the final authority (Warp only
  // banners in another app). Explicit `always` intentionally emits while focused.
  if (available.has('terminal')) channels.add('terminal')

  return channels
}
