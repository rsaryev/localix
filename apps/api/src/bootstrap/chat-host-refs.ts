/**
 * The plugin host's late-bound references that need the FINISHED chat service — bound once, the
 * moment it exists.
 *
 * The defect this seam guards against: the plugin hosts are built before chat (they are among
 * its inputs), so each reference they read from chat is a hole filled later. Spread through the
 * boot sequence, one hole could stay unfilled with nothing to show it until a plugin first woke a
 * session or a toggle first settled. Filling them in one place, in one call, right after chat is
 * built, keeps the set visible as a set. The ONE wake delivery is minted here too, because the
 * plugin hosts and every later phase share that same instance (`features/triggers/delivery.ts`).
 */
import type { WakeRequest } from '../features/chat/contracts'
import type { createChatService } from '../features/chat/service'
import { createWakeDelivery } from '../features/triggers/delivery'
import { createWakeOutboxRepository } from '../features/triggers/wake-outbox-repository'
import { createWakeNotices } from '../features/notifications/conditions/triggers'
import { announceCapabilitiesSettled } from '../features/capabilities/settle'
import { mcpClientManager } from '../features/mcp/client-manager'
import { startMcpChannels } from './mcp-channels'
import type { InfraPhase } from './infra'
import type { MiniAppHostRefs } from './plugin-host-refs'

export function bindChatHostRefs({
  hostRefs,
  chatService,
  env,
  logger,
  notifications,
  db,
}: Pick<InfraPhase, 'env' | 'logger' | 'notifications' | 'db'> & {
  hostRefs: MiniAppHostRefs
  chatService: ReturnType<typeof createChatService>
}) {
  // Fulfill the late-bound cwd resolver the plugin arg-options runner uses.
  hostRefs.chatServiceForCwd = chatService
  hostRefs.chatService = chatService
  // ONE wake delivery for every producer that cannot await a turn — trigger fires, plugin
  // backends and monitors, a finished child's report (see `features/triggers/delivery.ts`).
  const wakes = createWakeDelivery<WakeRequest>({
    // Claude Code mods' `session.receive` sees each delivery before it is queued: a rewrite is
    // what is queued, a `consumed` delivery is taken and nothing reaches the conversation.
    wake: async (request) => {
      const received = await hostRefs.mods?.receive?.({
        userId: request.userId,
        sessionId: request.sessionId,
        text: request.content,
        source: request.source,
      })
      if (received && 'consumed' in received) return { delivered: true }
      return chatService.wakeSession(received ? { ...request, content: received.text } : request)
    },
    outbox: createWakeOutboxRepository<WakeRequest>(db),
    logger,
    onUndelivered: createWakeNotices(notifications),
  })
  hostRefs.wakes = wakes
  // Claude Code channels: an event a plugin's MCP server pushes is a turn in the chat that last
  // used the server; events arriving while it is busy wait together and run as one turn.
  mcpClientManager.deliverChannelEvents(({ userId, sessionId, serverId, content }) =>
    wakes.send(
      { userId, sessionId, content, source: 'external', coalesce: `channel:${serverId}` },
      `MCP channel ${serverId}`,
    ),
  )
  // Keep each channel's chat across restarts and start the kept ones now; a channel's verdict on
  // an approval card settles it through the same path a click takes.
  void startMcpChannels({
    db,
    answer: (userId, requestId, allow) =>
      chatService.interact(requestId, 'respond', { answers: { confirmed: allow } }, userId),
    logger: { warn: (msg, meta) => logger.warn({ event: 'mcp_channel.warn', msg, meta }) },
  })
  // Capability owners notify the same resource channel as every other shared read model.
  // The authoritative snapshot carries its revision; plugin hosts announce only after settling.
  hostRefs.publishCapabilityChange = () =>
    chatService.streamRegistry.publish(env.LOCALIX_DEFAULT_USER_ID, '', {
      type: 'resources.changed',
      resources: ['capabilities'],
    })
  // Fulfill the backend host's settle hook: after a plugin toggle's re-wire CONVERGES,
  // release any toggle request waiting to answer with a settled snapshot, then tell
  // every firehose client to refetch. Waiters first — the request that started the
  // re-wire should not have to hear about it through the broadcast.
  hostRefs.onBackendHostSettled = () => {
    announceCapabilitiesSettled()
    hostRefs.publishCapabilityChange?.()
  }
  return { wakes }
}
