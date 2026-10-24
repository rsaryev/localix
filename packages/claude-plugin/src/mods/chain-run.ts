import { HookTimeout, type Meter } from './budget'
import {
  MOD_TIER,
  TIERS,
  type Hook,
  type HookFailure,
  type HookOrigin,
  type Next,
  type TargetTier,
} from './chain'
import { freezeDeep, pausedApi, type ModsApi } from './intercept'
import { matchesEvent, matchesEventName, type Matcher } from './matcher'
import { drive, isHookBody, openStream, type OpenStream, type Outcome } from './stream'
import { STREAMING_EVENTS } from './turn-step-stream'
import { traceEntry, type TraceEntry, type TraceOutcome } from './trace'

/**
 * How one dispatch runs down the chain: each matching hook in turn, with its own `$` and `next`,
 * under its budget; a failed hook's `.catch` handler; the host's `core` at the bottom.
 */

export interface HookEntry {
  plugin: string
  pattern: string
  matcher?: Matcher
  hook: Hook
  onError?: Hook
}

export interface RunOptions {
  origin?: HookOrigin
  signal?: AbortSignal
  plugins?: ReadonlySet<string>
}

export interface ChainRunnerDeps {
  budgetMs: number
  catchBudgetMs: number
  timed: (ms: number, work: (meter: Meter) => unknown) => Promise<unknown>
  /** The `$` a mod's hook gets where the event happens. */
  apiFor: (plugin: string, scope?: ReadonlySet<string>) => ModsApi
  report?: (plugin: string, event: string, reason: string) => void
}

const CORE: HookOrigin = { plugin: 'engine', tier: 'core' }

/** One `next` call: what it settles to, and the stream the hook reads it through. */
interface Call {
  outcome: Promise<Outcome>
  stream?: OpenStream
}

/** What a `next` call runs: an Outcome, and the chunk its stream starts at (a replay continues). */
type Open = (event: unknown, tier?: TargetTier) => { outcome: Promise<Outcome>; start: number }

interface Ran {
  value: unknown
  /** The hook was an async generator: what it yielded is what it streams. */
  body: boolean
}

export function failureOf(error: unknown): HookFailure {
  if (error instanceof HookTimeout) return { kind: 'timeout', message: 'ran out of time' }
  return { kind: 'throw', message: error instanceof Error ? error.message : String(error) }
}

/** Why an abandoned event rejects: its signal's reason. */
const abandonment = (signal: AbortSignal) =>
  signal.reason instanceof Error ? signal.reason : new Error('the event was abandoned')

export function createChainRunner(deps: ChainRunnerDeps) {
  async function run(
    event: string,
    chain: readonly HookEntry[],
    index: number,
    input: unknown,
    core: (event: unknown) => unknown,
    opts: RunOptions,
  ): Promise<Outcome> {
    const site = STREAMING_EVENTS.get(event)
    const signal = opts.signal ?? new AbortController().signal
    const bottom = async (e: unknown): Promise<Outcome> => {
      // An abandoned event goes no further: what it would have run beneath does not run.
      if (signal.aborted) throw abandonment(signal)
      const link = { index: chain.length, plugin: 'engine', event, startedAt: Date.now() }
      const value = await core(e)
      const trace = [traceEntry(link, 'returned', e, value)]
      return { value, chunks: site ? site.chunksOf(value) : [], trace }
    }
    for (let i = index; i < chain.length; i++) {
      const entry = chain[i]!
      if (!matchesEvent(entry.matcher, input)) continue
      const frozen = freezeDeep(input)
      const api = deps.apiFor(entry.plugin, opts.plugins)
      const link = { index: i, plugin: entry.plugin, event, startedAt: Date.now() }
      /** This link's outcome, its own entry ahead of what settled beneath it. */
      const traced = (
        outcome: Outcome,
        kind: TraceOutcome,
        beneath: readonly TraceEntry[] = [],
      ): Outcome => ({
        ...outcome,
        trace: [traceEntry(link, kind, frozen, outcome.value), ...beneath],
      })
      // Each call runs what is beneath afresh, so a hook may retry it.
      const beneath = (next: unknown, tier?: TargetTier): Promise<Outcome> => {
        const e = next === undefined ? input : next
        if (tier === undefined) return run(event, chain, i + 1, e, core, opts)
        if (!TIERS.includes(tier)) throw new Error(`next.to: no tier named ${String(tier)}`)
        // Every hook here is a mod's; a tier beneath theirs is the host's behaviour.
        return TIERS.indexOf(tier) > TIERS.indexOf(MOD_TIER)
          ? Promise.resolve().then(() => bottom(e))
          : run(event, chain, i + 1, e, core, opts)
      }

      const makeNext = (
        meter: Meter,
        ms: number,
        extra: object,
        open: Open,
        record: (call: Call) => void,
        signal: AbortSignal,
      ): Next => {
        let trace: readonly TraceEntry[] = []
        const call = (e: unknown, tier?: TargetTier) => {
          const { outcome, start } = open(e, tier)
          // The trace of the latest call: what settled beneath, filled once it settles.
          trace = []
          const mine = outcome.then((settled) => {
            if (latest === mine) trace = settled.trace ?? []
          })
          latest = mine
          mine.catch(() => {})
          const paused = meter.pause(outcome)
          if (!site) {
            record({ outcome })
            return paused.then((settled) => settled.value)
          }
          const stream = openStream(paused, start)
          record({ outcome, stream })
          return stream
        }
        const budget = {
          ms,
          get remainingMs() {
            return meter.remainingMs()
          },
        }
        let latest: Promise<void> | undefined
        const next = Object.assign((e?: unknown) => call(e), {
          to: (e: unknown, tier: TargetTier) => call(e, tier),
          signal,
          origin: opts.origin ?? CORE,
          budget,
          event,
          is: (pattern: unknown) => matchesEventName(String(pattern), event),
          ...extra,
        })
        // Read fresh: the trace of the latest call, once it settled.
        return Object.defineProperty(next, 'trace', { get: () => trace }) as unknown as Next
      }

      const runHook = (
        hook: Hook,
        ms: number,
        extra: object,
        open: Open,
        record: (call: Call) => void,
        yielded: unknown[],
      ): Promise<Ran> => {
        // Once this run settled, ran out or threw, the chain has moved on without it: a late
        // `next` (a stashed one, one after its own wait) replays its last call, never runs
        // what is beneath again, and its signal aborts so its own work can stop.
        let over = false
        let mine: Call | null = null
        const own = new AbortController()
        const abandon = () => own.abort(signal.reason)
        if (signal.aborted) abandon()
        else signal.addEventListener('abort', abandon, { once: true })
        const gated: Open = (e, tier) => {
          if (!over) return open(e, tier)
          if (mine) return { outcome: mine.outcome, start: 0 }
          const late = new Error(`next called after the ${event} hook of ${entry.plugin} ended`)
          return { outcome: Promise.reject(late), start: 0 }
        }
        const remember = (call: Call) => {
          if (over) return
          mine = call
          record(call)
        }
        const ran = deps.timed(ms, async (meter): Promise<Ran> => {
          const answer = hook(
            pausedApi(api, meter.pause),
            frozen,
            makeNext(meter, ms, extra, gated, remember, own.signal),
          )
          return isHookBody(answer)
            ? { value: await drive(answer, yielded), body: true }
            : { value: await answer, body: false }
        }) as Promise<Ran>
        const end = (failed: boolean) => {
          over = true
          signal.removeEventListener('abort', abandon)
          if (failed) own.abort(new Error(`the ${event} hook of ${entry.plugin} was skipped`))
        }
        return ran.then(
          (value) => (end(false), value),
          (error: unknown) => {
            end(true)
            throw error
          },
        )
      }

      /** The hook threw or ran out of time: its `.catch` handler answers, else it is left. */
      const failed = async (
        error: unknown,
        hookLast: Call | null,
        sofar: unknown[],
      ): Promise<Outcome> => {
        const failure = failureOf(error)
        let caughtLast: Call | null = null
        if (entry.onError) {
          // The handler runs once the hook's last call settled.
          await hookLast?.outcome.catch(() => {})
          let once: Promise<Outcome> | null = null
          const replay: Open = (e, tier) =>
            hookLast
              ? { outcome: hookLast.outcome, start: hookLast.stream?.read ?? 0 }
              : { outcome: (once ??= beneath(e, tier)), start: 0 }
          const caughtYield: unknown[] = []
          try {
            const caught = await runHook(
              entry.onError,
              deps.catchBudgetMs,
              { error: failure, called: hookLast !== null },
              replay,
              (call) => (caughtLast = call),
              caughtYield,
            )
            if (caught.value !== undefined)
              return traced(
                {
                  value: caught.value,
                  chunks: caught.body
                    ? [...sofar, ...caughtYield]
                    : (site?.chunksOf(caught.value) ?? []),
                },
                'caught',
              )
          } catch (catchError) {
            deps.report?.(entry.plugin, event, `.catch failed: ${failureOf(catchError).message}`)
          }
        }
        deps.report?.(entry.plugin, event, `hook skipped: ${failure.kind} ${failure.message}`)
        // Before `next`: the hook is skipped. After `next`: its last call's result stands, and
        // the chunks it had not passed on follow the ones it had.
        const standing = (caughtLast as Call | null) ?? hookLast
        if (standing) {
          const settled = await standing.outcome
          return traced(
            {
              value: settled.value,
              chunks: [...sofar, ...settled.chunks.slice(standing.stream?.read ?? 0)],
            },
            failure.kind === 'timeout' ? 'expired' : 'kept',
            settled.trace,
          )
        }
        const rest = await run(event, chain, i + 1, input, core, opts)
        return traced(
          { value: rest.value, chunks: [...sofar, ...rest.chunks] },
          failure.kind === 'timeout' ? 'expired' : 'skipped',
          rest.trace,
        )
      }

      let last: Call | null = null
      const yielded: unknown[] = []
      let ran: Ran
      try {
        ran = await runHook(
          entry.hook,
          deps.budgetMs,
          {},
          (e, tier) => ({ outcome: beneath(e, tier), start: 0 }),
          (call) => (last = call),
          yielded,
        )
      } catch (error) {
        if (signal.aborted) throw abandonment(signal)
        return await failed(error, last, yielded.slice())
      }
      // Returning nothing lets the hook's last `next` stand; without one, the hook was absent.
      const called = last as Call | null
      const settled = called ? await called.outcome.catch(() => null) : null
      if (ran.value !== undefined)
        return traced(
          { value: ran.value, chunks: ran.body ? yielded : (site?.chunksOf(ran.value) ?? []) },
          settled && settled.value === ran.value ? 'passed' : 'returned',
          settled?.trace,
        )
      if (called) {
        const passed = await called.outcome
        return traced(
          { value: passed.value, chunks: ran.body ? yielded : passed.chunks },
          'passed',
          passed.trace,
        )
      }
      if (ran.body && yielded.length > 0 && site)
        return traced({ value: site.resultOf(input, yielded), chunks: yielded }, 'returned')
      continue
    }
    return bottom(input)
  }
  return run
}
