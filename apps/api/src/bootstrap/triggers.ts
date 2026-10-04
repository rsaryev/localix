/**
 * Triggers, wired: every action a fire can take, the engine that decides when, and the services
 * built on it — loops, monitors and exit notices. Their wakes go through the one delivery
 * `bootstrap.ts` binds.
 *
 * The order is the dependency order and nothing else:
 *
 *   actions (loop, monitor, exit-notice) → engine (when; kinds cron, delay, poll,
 *   stream, process-exit) → services (loops, monitors, exit notices) → bind → hydrate →
 *   monitors resume → work left unclaimed is lost.
 *
 * The last three are the boot's recovery, and their order is the point: a polled wait resumes
 * from its trigger's row, so its work record may only be declared lost once the triggers have
 * loaded and the monitors have taken theirs back (`features/work/registry.ts` `hydrate`).
 *
 * Deadlines are NOT set here. `hydrate` only loads and recovers; `start` runs post-listen with the
 * other engines, so nothing fires — and no restart notice wakes anyone — into a server that is not
 * accepting connections yet.
 */
import { createChatRepository } from '../features/chat/repository'
import type { WakeRequest } from '../features/chat/contracts'
import { createExitNoticeAction, createExitNotices } from '../features/chat/runtime/exit-notices'
import { markLostWorkItems } from '../features/chat/runtime/lost-work'
import type { createChatService } from '../features/chat/service'
import { LOOP_ACTION } from '../features/loops/action'
import { toLoopSummary } from '../features/loops/contracts'
import { setLoopEngine } from '../features/loops/runtime-binding'
import { createLoopService } from '../features/loops/service'
import { setMonitorService } from '../features/monitors/runtime-binding'
import type { WakeDelivery } from '../features/triggers/delivery'
import { createTriggerEngine } from '../features/triggers/engine'
import { cronKind } from '../features/triggers/kinds/cron'
import { delayKind } from '../features/triggers/kinds/delay'
import { pollKind } from '../features/triggers/kinds/poll'
import { processExitKind } from '../features/triggers/kinds/process-exit'
import { streamKind } from '../features/triggers/kinds/stream'
import { createTriggerRepository } from '../features/triggers/repository'
import { createTriggerConditions } from '../features/notifications/conditions/triggers'
import type { InfraPhase } from './infra'
import { buildLoopAction } from './loop-action'
import { wireMonitors } from './monitors'

export interface TriggersWiringInput extends Pick<
  InfraPhase,
  | 'db'
  | 'logger'
  | 'serviceRefs'
  | 'secretsStore'
  | 'secretExposureShield'
  | 'work'
  | 'notifications'
> {
  chatService: ReturnType<typeof createChatService>
  /** The one wake delivery every fire goes through (bound in `bootstrap.ts`). */
  wakes: WakeDelivery<WakeRequest>
  finalAssistantText: InfraPhase['digests']['finalAssistantText']
}

export async function wireTriggers(input: TriggersWiringInput) {
  const { db, logger, serviceRefs, chatService, work, wakes } = input
  const monitors = wireMonitors({ ...input, delivery: wakes })
  // A loop that keeps failing is a standing Event Center row until a fire succeeds or it ends.
  const triggerConditions = createTriggerConditions(input.notifications)

  const triggerEngine = createTriggerEngine({
    repo: createTriggerRepository(db),
    kinds: [cronKind, delayKind, pollKind, streamKind, processExitKind],
    actions: [
      buildLoopAction(input),
      monitors.action,
      createExitNoticeAction((...args) => wakes.deliver(...args)),
    ],
    onFireSettled: (...args) => triggerConditions.fireSettled(...args),
    onChange: (trigger) => {
      if (trigger.action !== LOOP_ACTION) return
      if (trigger.state === 'ended') triggerConditions.loopEnded(trigger.userId, trigger.id)
      chatService.streamRegistry.publish(trigger.userId, trigger.sessionId, {
        type: 'session_triggers.updated',
        sessionId: trigger.sessionId,
        loops: loops.list(trigger.userId, trigger.sessionId).map(toLoopSummary),
      })
    },
    logger: { warn: (msg) => logger.warn({ event: 'trigger.warn', msg }) },
  })

  const loops = createLoopService({
    triggers: triggerEngine,
    cancelWake: chatService.cancelWake,
  })
  setLoopEngine(loops)
  // Reachable from the agent runner's tool build and from chat's session-delete reap, both of
  // which exist before this service does — see `features/monitors/runtime-binding.ts`.
  serviceRefs.monitorService = monitors.bind(triggerEngine)
  setMonitorService(serviceRefs.monitorService)
  serviceRefs.exitNotices = createExitNotices(triggerEngine, {
    warn: (msg) => logger.warn({ event: 'exit_notice.warn', msg }),
  })
  // A busy-held occurrence is owed the moment its session frees up — no polling.
  chatService.onSessionIdle((sessionId) => triggerEngine.poke(sessionId))

  await triggerEngine.hydrate()
  await serviceRefs.monitorService.resume()
  await markLostWorkItems(
    createChatRepository(db),
    await work.losePending(),
    new Date().toISOString(),
    { warn: (msg) => logger.warn({ event: 'work.lost_item', msg }) },
  )
  return { triggerEngine, loops }
}
