/**
 * Monitors as production composes them — a real trigger engine on a real database, a real work
 * registry — with the edges a test must control swapped out: the check, the watched process, the
 * clock, the deadlines and the wake. Shared by this folder's tests.
 */
import { testWork } from '../../testing/work-fixture'
import { flush, triggerHarness } from '../triggers/test-harness'
import type { WakeOutcome, WakeShape } from '../triggers/delivery'
import type { WorkRecord } from '../work/contracts'
import { createMonitors, type MonitorsDeps } from './compose'
import type { MonitorEndReason, MonitorEvent, MonitorSpec } from './contracts'
import type { MonitorHooks } from './report'
import type { CheckRun, MonitorSource, MonitorSourceExit } from './sources'

/** A `watch` source a test drives by hand: no process, no timer. */
export function fakeSource() {
  let emit: (text: string) => void = () => {}
  let settle: (exit: MonitorSourceExit) => void = () => {}
  let closed = false
  const source: MonitorSource = {
    onEvent: (listener) => void (emit = listener),
    start: () => {},
    close: () => void (closed = true),
    exited: new Promise<MonitorSourceExit>((resolve) => (settle = resolve)),
  }
  return { source, event: (text: string) => emit(text), end: settle, isClosed: () => closed }
}

export type Sample = { stdout?: string; stderr?: string; exitCode?: number }

export async function monitorHarness(
  over: Partial<Pick<MonitorsDeps, 'resolveSecret' | 'shield' | 'tuning' | 'runCheck'>> & {
    samples?: Sample[]
    /** Model a run with no vault at all. */
    noVault?: boolean
    /** Real checks and real watched processes (`./sources/native`). */
    real?: boolean
  } = {},
) {
  const t = await triggerHarness()
  for (const id of ['s2'])
    await t.db
      .insertInto('agent_sessions')
      .values({ project_id: 'PRJ-test', id, user_id: 'u1', title: id })
      .execute()
  let work = testWork(t.db)
  const wakes: WakeShape[] = []
  const settled: { record: WorkRecord; reason: MonitorEndReason }[] = []
  const sources: ReturnType<typeof fakeSource>[] = []
  const samples = [...(over.samples ?? [])]
  const checks: string[] = []
  const runCheck: CheckRun =
    over.runCheck ??
    (async ({ command }) => {
      checks.push(command)
      const next = samples.length > 1 ? samples.shift()! : (samples[0] ?? {})
      return { stdout: next.stdout ?? '', stderr: next.stderr ?? '', exitCode: next.exitCode ?? 0 }
    })
  let outcome: WakeOutcome = { status: 'delivered' }

  const compose = () =>
    createMonitors({
      work,
      deliver: async (request) => {
        wakes.push(request)
        return outcome
      },
      settleItem: (record, reason) => settled.push({ record, reason }),
      ...(over.real
        ? {}
        : {
            runCheck,
            createSource: () => {
              const next = fakeSource()
              sources.push(next)
              return next.source
            },
          }),
      // Deliver every event immediately: the coalescing window is batch.test.ts's subject.
      tuning: over.tuning ?? { batchWindowMs: 0 },
      now: () => new Date(t.clock.ms),
      ...(over.noVault ? {} : { resolveSecret: over.resolveSecret ?? (async () => undefined) }),
      ...(over.shield ? { shield: over.shield } : {}),
    })

  let monitors = compose()
  let engine = t.engine({ actions: [monitors.action] })
  let service = monitors.bind(engine)

  /** Start a monitor the way `bash until` does: start it, then record its work on the card's call. */
  const start = async (
    spec: MonitorSpec,
    at: { sessionId?: string; userId?: string; toolCallId?: string; hooks?: MonitorHooks } = {},
  ) => {
    const owner = {
      userId: at.userId ?? 'u1',
      sessionId: at.sessionId ?? 's1',
      agentId: 'lead',
      toolCallId: at.toolCallId ?? `tc-${Math.random().toString(36).slice(2)}`,
    }
    const started = await service.start(owner, spec, at.hooks)
    if (started.ok)
      work.start({
        owner,
        agentId: 'lead',
        kind: 'monitor',
        label: started.label,
        toolCallId: owner.toolCallId,
        messageId: 'm1',
        displayId: started.id,
      })
    return started
  }

  return {
    ...t,
    get work() {
      return work
    },
    wakes,
    settled,
    sources,
    checks,
    get engine() {
      return engine
    },
    get service() {
      return service
    },
    start,
    failWakes: (next: WakeOutcome) => void (outcome = next),
    /** Run every poll due now. */
    poll: async () => {
      await t.advanceTo(new Date(t.clock.ms).toISOString(), engine)
      await flush()
      await flush()
    },
    /** The process dies; a new one loads the same database. */
    async restart() {
      // Let the rows written behind the live indexes land, as a dying process's would have.
      await settle()
      work = testWork(t.db)
      await work.hydrate()
      t.deadlines.clear()
      monitors = compose()
      engine = t.engine({ actions: [monitors.action] })
      service = monitors.bind(engine)
      await engine.hydrate()
      await service.resume()
      const lost = await work.losePending()
      await engine.start()
      return lost
    },
  }
}

export const events = (...texts: string[]): MonitorEvent[] =>
  texts.map((text, index) => ({ at: index, text }))

/** Let the batcher's 0 ms window and the fire cycle run. */
export const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5))
