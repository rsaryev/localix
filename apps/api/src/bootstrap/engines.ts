/**
 * Engines phase: the long-lived trigger engine loops and monitors run on (`./triggers`), plus
 * the start of its deadlines.
 *
 * The per-session services that also need a finished `chatService` are wired by
 * `./session-services`.
 */
import type { createChatService } from '../features/chat/service'
import type { LoopService } from '../features/loops/service'
import { createUsageRepository } from '../features/usage/repository'
import { wireTriggers, type TriggersWiringInput } from './triggers'
import { wireSessionServices } from './session-services'
import type { InfraPhase } from './infra'
import type { DomainServicesPhase } from './domain-services'

export interface EnginesPhaseInput
  extends
    Pick<
      InfraPhase,
      | 'db'
      | 'logger'
      | 'serviceRefs'
      // Forwarded to the monitor service: a watch may reference a vault key, and its output
      // must be redacted before it becomes a persisted wake.
      | 'secretsStore'
      | 'secretExposureShield'
      // A monitor is a trigger plus a work record: its `mon-N` comes from the one work namespace.
      | 'work'
      // Its open-questions push and the consequence of each close are wired with the session services.
      | 'questions'
      // A loop that keeps failing becomes a standing Event Center row.
      | 'notifications'
      // The attention registry and the plan's sources, wired with the session services.
      | 'agentNotifications'
    >,
    Pick<DomainServicesPhase, 'resolveProjectCwd' | 'lspManager'> {
  chatService: ReturnType<typeof createChatService>
  wakes: TriggersWiringInput['wakes']
  finalAssistantText: InfraPhase['digests']['finalAssistantText']
}

export interface EnginesPhase {
  auxUsageRepo: ReturnType<typeof createUsageRepository>
  loops: LoopService
  startEngines: () => void
}

export async function createEnginesPhase({
  db,
  logger,
  serviceRefs,
  chatService,
  wakes,
  finalAssistantText,
  lspManager,
  secretsStore,
  secretExposureShield,
  work,
  questions,
  notifications,
  agentNotifications,
}: EnginesPhaseInput): Promise<EnginesPhase> {
  wireSessionServices({
    db,
    serviceRefs,
    chatService,
    lspManager,
    work,
    questions,
    wakes,
    agentNotifications,
  })

  // Shared ledger writer for auxiliary LLM calls (inline completion across inputs and
  // editor transforms).
  // Their spend accumulates onto one row per (session, kind) so it surfaces in the
  // Usage Kind breakdown without a row per call. Same table/writer as chat turns —
  // no parallel accounting.
  const auxUsageRepo = createUsageRepository(db)

  // Loops and monitors on the durable trigger engine (`./triggers`): hydrated here, deadlines set
  // post-listen.
  const { triggerEngine, loops } = await wireTriggers({
    db,
    logger,
    serviceRefs,
    secretsStore,
    secretExposureShield,
    work,
    notifications,
    chatService,
    wakes,
    finalAssistantText,
  })

  const startEngines = (): void => {
    void triggerEngine.start()
  }

  return {
    auxUsageRepo,
    loops,
    startEngines,
  }
}
