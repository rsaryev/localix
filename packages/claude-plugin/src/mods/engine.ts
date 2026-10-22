import { createBudget, HookTimeout, SYSTEM_CLOCK, type BudgetClock } from './budget'
import { matchesEvent, matchesEventName, type Matcher } from './matcher'

/**
 * The mods engine: the middleware chain Claude Code runs every mod's hooks in, without a host.
 *
 * A mod's hooks module exports `register(on, options)`; each `on(event, matcher?, hook)` adds a
 * hook. Hooks on one event form one chain in load order (within a module, in `on` order): a hook
 * gets the mods API (`$`), the event (`e`, deeply frozen) and `next`, which runs the rest of the
 * chain and then the host's own behaviour (`core`). A hook observes (`return next(e)`), rewrites
 * (`next({ ...e, text })`) or answers (returns without calling `next`). A hook that throws or runs
 * out of time is skipped — or, after its `next` resolved, that result stands — unless its `.catch`
 * handler answers. Every mods API call is an event too (`fs.read`), which other mods may hook.
 */

/** A mods API: namespaces of methods (`$.fs.read`) and values (`$.plugin.name`). */
export type ModsApi = Record<string, Record<string, unknown>>

export interface HookFailure {
  kind: 'throw' | 'timeout'
  message: string
}

export interface HookOrigin {
  plugin: string
  tier: 'user' | 'core'
}

export interface Next {
  (event?: unknown): Promise<unknown>
  readonly signal: AbortSignal
  readonly origin: HookOrigin
  readonly budget: { readonly ms: number; readonly remainingMs: number }
  /** In a `.catch` handler: why the hook failed, and whether it had called `next`. */
  readonly error?: HookFailure
  readonly called?: boolean
}

export type Hook = ($: ModsApi, event: unknown, next: Next) => unknown
export interface Registration {
  catch(handler: Hook): Registration
}
export type On = (event: string, matcherOrHook: Matcher | Hook, hook?: Hook) => Registration
export type RegisterFunction = (on: On, options: Record<string, unknown>) => unknown

export class ModLoadError extends Error {}

interface HookEntry {
  plugin: string
  pattern: string
  matcher?: Matcher
  hook: Hook
  onError?: Hook
}

export interface DispatchOptions {
  origin?: HookOrigin
  signal?: AbortSignal
  /** A mods API call fires its event past the hooks of the mod that made it (no re-entry). */
  skipPlugin?: string
}

export interface ModsEngineOptions {
  /** A hook's own time, not counting time inside `next` or a mods API call. */
  budgetMs?: number
  catchBudgetMs?: number
  /** One line per skipped hook: the mod, the event and why. */
  report?: (plugin: string, event: string, reason: string) => void
  /** The clock budgets run on; injected by tests. */
  clock?: BudgetClock
}

const CORE: HookOrigin = { plugin: 'engine', tier: 'core' }

/** A deep, frozen copy of plain data; anything else (a function, a class instance) as it is. */
export function freezeDeep<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeDeep)) as T
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const copy: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(value)) copy[key] = freezeDeep(field)
    return Object.freeze(copy) as T
  }
  return value
}

export function createModsEngine(options: ModsEngineOptions = {}) {
  const budgetMs = options.budgetMs ?? 10_000
  const catchBudgetMs = options.catchBudgetMs ?? 1_000
  const timed = createBudget(options.clock ?? SYSTEM_CLOCK)
  let hooks: HookEntry[] = []
  const apis = new Map<string, ModsApi>()

  async function run(
    event: string,
    chain: readonly HookEntry[],
    index: number,
    input: unknown,
    core: (event: unknown) => unknown,
    opts: DispatchOptions,
  ): Promise<unknown> {
    const signal = opts.signal ?? new AbortController().signal
    for (let i = index; i < chain.length; i++) {
      const entry = chain[i]!
      if (!matchesEvent(entry.matcher, input)) continue
      const frozen = freezeDeep(input)
      let downstream: Promise<unknown> | null = null
      const rest = (next?: unknown) =>
        (downstream ??= run(event, chain, i + 1, next === undefined ? input : next, core, opts))
      const makeNext = (pause: <T>(p: Promise<T>) => Promise<T>, extra = {}): Next =>
        Object.assign((next?: unknown) => pause(rest(next)), {
          signal,
          origin: opts.origin ?? CORE,
          budget: { ms: budgetMs, remainingMs: budgetMs },
          ...extra,
        }) as Next
      const api = apis.get(entry.plugin) ?? {}
      try {
        const answer = await timed(budgetMs, (pause) => entry.hook(api, frozen, makeNext(pause)))
        return answer === undefined ? await rest() : answer
      } catch (error) {
        const failure = failureOf(error)
        if (entry.onError) {
          try {
            const caught = await timed(catchBudgetMs, (pause) =>
              entry.onError!(
                api,
                frozen,
                makeNext(pause, { error: failure, called: downstream !== null }),
              ),
            )
            if (caught !== undefined) return caught
          } catch (catchError) {
            options.report?.(entry.plugin, event, `.catch failed: ${failureOf(catchError).message}`)
          }
        }
        options.report?.(entry.plugin, event, `hook skipped: ${failure.kind} ${failure.message}`)
        // Before `next`: the hook is skipped. After `next` resolved: that result stands.
        return await rest()
      }
    }
    return core(input)
  }

  const engine = {
    /** Load one mod: call its `register`, keeping its hooks only if it loads whole. */
    async load(
      plugin: string,
      register: RegisterFunction,
      registerOptions: Record<string, unknown>,
      api: ModsApi,
    ): Promise<string[]> {
      const added: HookEntry[] = []
      const unmatched = new Set<string>()
      const on: On = (event, matcherOrHook, hook) => {
        const entry: HookEntry =
          typeof matcherOrHook === 'function'
            ? { plugin, pattern: event, hook: matcherOrHook }
            : { plugin, pattern: event, matcher: matcherOrHook, hook: hook! }
        if (typeof entry.hook !== 'function')
          throw new ModLoadError(`on("${event}") needs a hook function`)
        if (!entry.matcher) {
          if (unmatched.has(event))
            throw new ModLoadError(`on("${event}") is registered twice without a matcher`)
          unmatched.add(event)
        }
        added.push(entry)
        const registration: Registration = {
          catch(handler) {
            entry.onError = handler
            return registration
          },
        }
        return registration
      }
      engine.unload(plugin)
      apis.set(plugin, engine.interceptApi(plugin, api))
      try {
        await register(on, registerOptions)
      } catch (error) {
        apis.delete(plugin)
        throw error instanceof ModLoadError ? error : new ModLoadError(failureOf(error).message)
      }
      hooks = [...hooks, ...added]
      return [...new Set(added.map((entry) => entry.pattern))]
    },

    unload(plugin: string): void {
      hooks = hooks.filter((entry) => entry.plugin !== plugin)
      apis.delete(plugin)
    },

    plugins(): string[] {
      return [...apis.keys()]
    },

    /** The API a mod's hooks receive, for calls the host makes on its behalf. */
    apiOf(plugin: string): ModsApi | undefined {
      return apis.get(plugin)
    },

    /** True when some hook could see `event` (a host may skip building an event nobody hears). */
    hears(event: string, plugins?: ReadonlySet<string>): boolean {
      return hooks.some(
        (entry) =>
          matchesEventName(entry.pattern, event) && (!plugins || plugins.has(entry.plugin)),
      )
    },

    /**
     * Run `event` through the hooks that match it, then `core`. `plugins` limits the chain to the
     * mods enabled where the event happens.
     */
    dispatch(
      event: string,
      input: unknown,
      core: (event: unknown) => unknown,
      opts: DispatchOptions & { plugins?: ReadonlySet<string> } = {},
    ): Promise<unknown> {
      const chain = hooks.filter(
        (entry) =>
          matchesEventName(entry.pattern, event) &&
          entry.plugin !== opts.skipPlugin &&
          (!opts.plugins || opts.plugins.has(entry.plugin)),
      )
      if (chain.length === 0) return Promise.resolve().then(() => core(input))
      return run(event, chain, 0, input, core, opts)
    },

    /** Every method of `api` becomes an event other mods may hook (`fs.read`, `ui.toast`). */
    interceptApi(plugin: string, api: ModsApi): ModsApi {
      const intercepted: ModsApi = {}
      for (const [namespace, members] of Object.entries(api)) {
        const wrapped: Record<string, unknown> = {}
        for (const [name, member] of Object.entries(members)) {
          if (typeof member !== 'function') {
            wrapped[name] = member
            continue
          }
          const event = `${namespace}.${name}`
          const method = member as (...args: unknown[]) => unknown
          wrapped[name] = (first?: unknown, ...rest: unknown[]) =>
            engine.hears(event)
              ? engine.dispatch(event, first ?? {}, (e) => method(e, ...rest), {
                  origin: { plugin, tier: 'user' },
                  skipPlugin: plugin,
                })
              : method(first, ...rest)
        }
        intercepted[namespace] = wrapped
      }
      return intercepted
    },
  }
  return engine
}

export type ModsEngine = ReturnType<typeof createModsEngine>

function failureOf(error: unknown): HookFailure {
  if (error instanceof HookTimeout) return { kind: 'timeout', message: 'ran out of time' }
  return { kind: 'throw', message: error instanceof Error ? error.message : String(error) }
}
