import type {
  NotificationChannel,
  NotificationContext,
  NotificationDeliveryReport,
  NotificationEnvelope,
  NotificationTransport,
} from './contracts'
import { notificationChannels } from './policy'

export interface NotificationRouter {
  route(
    envelope: NotificationEnvelope,
    context: NotificationContext,
    transports: readonly NotificationTransport[],
  ): Promise<NotificationDeliveryReport>
  /**
   * Forget the dedupe state of every key under `prefix` except `keep`.
   *
   * A standing condition is deduplicated for as long as it is true, and its key is derived from what
   * is wrong. Once it SETTLES, that key must be routable again: otherwise the same problem coming
   * back within the window is dropped here and the journal keeps saying "Resolved" about it.
   */
  forget(prefix: string, keep?: string): void
  reset(): void
}

/** Stateful dedupe/TTL boundary. Transport failures are isolated from each other. */
export function createNotificationRouter(): NotificationRouter {
  // dedupe key -> expiry. A stable run/request id prevents replay duplicates
  // without conflating two legitimate runs in the same session.
  const seen = new Map<string, number>()

  return {
    async route(envelope, context, transports) {
      // NOT a short-circuit any more. The TTL used to drop the envelope here, before the policy was
      // ever consulted — so a durable fact replayed after a gap was lost outright even though the
      // policy's own rule is that history survives suppression. The policy owns the decision now; the
      // router only reports which of its two "nothing was delivered" reasons applied.
      const expired = context.now - envelope.occurredAt > envelope.event.ttlMs

      const expiresAt = seen.get(envelope.event.dedupeKey)
      if (expiresAt !== undefined && context.now < expiresAt) {
        return { status: 'deduplicated', delivered: [], failed: [] }
      }
      seen.set(envelope.event.dedupeKey, context.now + envelope.event.dedupeWindowMs)

      // Bound state to active dedupe windows.
      for (const [key, expiry] of seen) {
        if (context.now >= expiry) seen.delete(key)
      }

      const available = new Set<NotificationChannel>(transports.map((t) => t.channel))
      const selected = notificationChannels(envelope, context, available)
      if (selected.size === 0) {
        return { status: expired ? 'expired' : 'suppressed', delivered: [], failed: [] }
      }

      const delivered: string[] = []
      const failed: { transportId: string; error: unknown }[] = []
      const deliveries: Promise<void>[] = []
      for (const transport of transports) {
        if (selected.has(transport.channel)) {
          deliveries.push(
            (async () => {
              try {
                await transport.deliver(envelope)
                delivered.push(transport.id)
              } catch (error) {
                failed.push({ transportId: transport.id, error })
              }
            })(),
          )
        }
      }
      await Promise.all(deliveries)
      return { status: 'delivered', delivered, failed }
    },
    forget(prefix, keep) {
      for (const key of seen.keys()) {
        if (key !== keep && key.startsWith(prefix)) seen.delete(key)
      }
    },
    reset() {
      seen.clear()
    },
  }
}
