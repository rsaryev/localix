/**
 * The `bash until` wait's engine, wired: the host ports a monitor needs from outside its feature.
 *
 * A monitor is a trigger (see `./triggers`, which registers its action) plus a work record, so
 * what is left to bind here is only what the rest of the server owns:
 *
 *   - the WAKE — the triggers' one delivery path, with the `bg-monitor` source, so the turn it
 *     opens is badged "via Monitor";
 *   - the VAULT — a watch against an authenticated endpoint needs its credential, which must not
 *     be in its command;
 *   - the SHIELD — a monitor's own output is an exposure path the rest of the runtime does not
 *     cover: its wake is persisted as a message;
 *   - the CARD — a monitor resumed by a restart has no run writing its tool item any more.
 */
import { createChatRepository } from '../features/chat/repository'
import { itemEndingOf, settleWorkItem } from '../features/chat/runtime/lost-work'
import type { createChatService } from '../features/chat/service'
import { createMonitors } from '../features/monitors/compose'
import type { WakeDelivery } from '../features/triggers/delivery'
import type { WakeRequest } from '../features/chat/contracts'
import { errorMessage } from '../lib/errors'
import type { InfraPhase } from './infra'

export interface MonitorsWiringInput extends Pick<
  InfraPhase,
  'db' | 'logger' | 'secretsStore' | 'secretExposureShield' | 'work'
> {
  chatService: ReturnType<typeof createChatService>
  delivery: WakeDelivery<WakeRequest>
}

export function wireMonitors({
  db,
  logger,
  secretsStore,
  secretExposureShield,
  work,
  chatService,
  delivery,
}: MonitorsWiringInput) {
  const repo = createChatRepository(db)
  return createMonitors({
    work,
    deliver: (...args) => delivery.deliver(...args),
    // The store's resolve is the SERVER-INTERNAL half of the vault (the one plugins and provider
    // connections use); the audit context names the MONITOR, so the vault's activity log can
    // answer "which watch used this key", not just "the agent".
    resolveSecret: async (userId, key, monitorId) => {
      const value = await secretsStore.resolve(userId, key, {
        actorType: 'agent',
        actorId: 'chat-runtime',
        consumerType: 'monitor',
        consumerId: monitorId,
      })
      // Registering here is what makes the shield below able to redact: `resolve` already does
      // it, and this is belt-and-braces for a store that might not.
      if (value) secretExposureShield.remember(userId, value)
      return value ?? undefined
    },
    // Forwarded opaquely: restating the parameters would let a dropped one pass tsc unnoticed.
    shield: (...args) => secretExposureShield.redactText(...args),
    settleItem: (record) =>
      void settleWorkItem(
        { repo, streamRegistry: chatService.streamRegistry },
        record,
        itemEndingOf(record.status),
        new Date().toISOString(),
      ).catch((error: unknown) =>
        logger.warn({
          event: 'monitor.item_not_settled',
          id: record.displayId,
          err: errorMessage(error),
        }),
      ),
    logger: { warn: (msg) => logger.warn({ event: 'monitor.warn', msg }) },
  })
}
