/**
 * A trigger engine on a REAL database with a hand-driven clock and deadlines — shared by the
 * engine's tests. The store is real because the compare-and-set lives in its WHERE clauses; the
 * clock and deadlines are fake because a test must say exactly when "now" is.
 */
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import type { FireGate, FireOutcome, TriggerAction, TriggerKind } from './contracts'
import type { TriggerEngineDeps } from './core'
import { createTriggerEngine, type TriggerEngine } from './engine'
import { cronKind } from './kinds/cron'
import { delayKind } from './kinds/delay'
import { pollKind } from './kinds/poll'
import { processExitKind } from './kinds/process-exit'
import { streamKind } from './kinds/stream'
import { createTriggerRepository, type TriggerRepository } from './repository'

export interface PendingFire {
  id: string
  deliveryKey: string
  event?: Record<string, unknown>
  settle: (outcome: FireOutcome) => void
}

/** An action whose gate the test sets and whose fires it settles by hand. */
export function scriptedAction(id = 'test') {
  const fires: PendingFire[] = []
  let gate: FireGate | null = null
  const action: TriggerAction = {
    id,
    gate: () => gate,
    fire: (trigger, { deliveryKey, event }) =>
      new Promise<FireOutcome>((settle) =>
        fires.push({ id: trigger.id, deliveryKey, ...(event ? { event } : {}), settle }),
      ),
  }
  return {
    action,
    fires,
    setGate: (next: FireGate | null) => {
      gate = next
    },
  }
}

/** Let a settled fire's continuation run through the engine's serializer. */
export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export async function triggerHarness(startIso = '2026-09-23T10:00:00.000Z') {
  const db = createDatabase()
  await migrateToLatest(db)
  await db
    .insertInto('agent_sessions')
    .values({ project_id: 'PRJ-test', id: 's1', user_id: 'u1', title: 't' })
    .execute()
  const clock = { ms: Date.parse(startIso) }
  const deadlines = new Map<string, number>()
  const repo: TriggerRepository = createTriggerRepository(db)
  const scripted = scriptedAction()
  const warnings: string[] = []

  const engine = (
    overrides: {
      repo?: TriggerRepository
      actions?: readonly TriggerAction[]
      kinds?: readonly TriggerKind[]
      onFireSettled?: TriggerEngineDeps['onFireSettled']
    } = {},
  ): TriggerEngine =>
    createTriggerEngine({
      ...(overrides.onFireSettled ? { onFireSettled: overrides.onFireSettled } : {}),
      repo: overrides.repo ?? repo,
      kinds: overrides.kinds ?? [cronKind, delayKind, pollKind, streamKind, processExitKind],
      actions: overrides.actions ?? [scripted.action],
      now: () => new Date(clock.ms),
      logger: { warn: (msg) => warnings.push(msg) },
      timers: () => ({
        scheduleAt: (id, ms) => void deadlines.set(id, ms),
        cancel: (id) => void deadlines.delete(id),
        close: async () => {},
      }),
    })

  const arm = (
    target: TriggerEngine,
    kind: 'cron' | 'delay' | 'poll' | 'stream',
    spec: Record<string, unknown>,
  ) =>
    target.arm({
      userId: 'u1',
      sessionId: 's1',
      owner: { kind: 'agent', agentId: 'lead' },
      action: 'test',
      kind,
      spec,
      payload: { note: 'x' },
    })

  return {
    db,
    repo,
    clock,
    deadlines,
    warnings,
    ...scripted,
    engine,
    arm,
    /** Move the clock and evaluate every trigger whose deadline has come. */
    async advanceTo(iso: string, target: TriggerEngine) {
      clock.ms = Date.parse(iso)
      // A snapshot, not the live map: an evaluation re-arms deadlines, and a re-armed one that is
      // already due must wait for the next advance rather than fire twice in this one.
      const due = Array.from(deadlines.entries()).filter(([, at]) => at <= clock.ms)
      for (const [id] of due) await target.evaluate(id)
    },
    close: () => destroyDatabase(db),
  }
}
