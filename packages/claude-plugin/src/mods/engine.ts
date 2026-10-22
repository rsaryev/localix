import { createBudget, HookTimeout, SYSTEM_CLOCK, type BudgetClock } from './budget'
import { freezeDeep, interceptApi, type ModsApi } from './intercept'
import { matchesEvent, matchesEventName, type Matcher } from './matcher'
import {
  MOD_TIER,
  TIERS,
  type Hook,
  type HookFailure,
  type HookOrigin,
  type Next,
  type On,
  type RegisterFunction,
  type Registration,
  type TargetTier,
} from './chain'

export type * from './chain'

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

export type { ModsApi } from './intercept'
export { freezeDeep } from './intercept'

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
  /** The mods enabled where the event happens; the chain and the nouns its `$` sees. */
  plugins?: ReadonlySet<string>
}

export interface ModsEngineOptions {
  /** A hook's own time, not counting time inside `next` or a mods API call. */
  budgetMs?: number
  catchBudgetMs?: number
  /** One line per skipped hook: the mod, the event and why. */
  report?: (plugin: string, event: string, reason: string) => void
  /** The clock budgets run on; injected by tests. */
  clock?: BudgetClock
  /**
   * The plugin a loaded mod belongs to, when a host loads one plugin's mod more than once (once
   * per project): its loads may add the same noun; two plugins may not.
   */
  pluginOf?: (mod: string) => string
  /** The mods a loaded mod's `$` calls reach: those running where it runs. Absent, every mod. */
  peersOf?: (mod: string) => ReadonlySet<string> | undefined
}

const CORE: HookOrigin = { plugin: 'engine', tier: 'core' }

export function createModsEngine(options: ModsEngineOptions = {}) {
  const budgetMs = options.budgetMs ?? 10_000
  const catchBudgetMs = options.catchBudgetMs ?? 1_000
  const timed = createBudget(options.clock ?? SYSTEM_CLOCK)
  let hooks: HookEntry[] = []
  const apis = new Map<string, ModsApi>()
  /** Nouns `engine.create` steps added (`$.telemetry`), by noun and then by the mod that did. */
  const nouns = new Map<string, Map<string, Record<string, unknown>>>()
  const pluginOf = options.pluginOf ?? ((mod: string) => mod)

  /** A mod's `$`: its own API, and each noun added by a mod where the event happens. */
  function apiFor(plugin: string, scope?: ReadonlySet<string>): ModsApi {
    const own = apis.get(plugin) ?? {}
    if (nouns.size === 0) return own
    const added: ModsApi = {}
    for (const [noun, byMod] of nouns) {
      const owners = [...byMod.keys()]
      const owner =
        (byMod.has(plugin) ? plugin : undefined) ??
        owners.find((mod) => scope?.has(mod)) ??
        owners[0]
      if (owner !== undefined && !(noun in own)) added[noun] = byMod.get(owner)!
    }
    return { ...added, ...own }
  }

  /** `engine.create`: the mod's steps build `$` from what is beneath; what they add is a noun. */
  async function create(plugin: string): Promise<void> {
    const base = apiFor(plugin)
    const built = await engine.dispatch('engine.create', { plugins: [plugin] }, () => base, {
      plugins: new Set([plugin]),
    })
    if (!built || typeof built !== 'object') return
    const own = apis.get(plugin) ?? {}
    for (const [noun, value] of Object.entries(built as Record<string, unknown>)) {
      // Core's nouns, and one another mod added passed through as it was, are not this mod's.
      if (noun in own || value === base[noun] || !value || typeof value !== 'object') continue
      const byMod = nouns.get(noun) ?? new Map<string, Record<string, unknown>>()
      const rival = [...byMod.keys()].find((mod) => pluginOf(mod) !== pluginOf(plugin))
      if (rival !== undefined)
        throw new ModLoadError(`engine.create: ${noun} is ${pluginOf(rival)}'s noun already`)
      // A noun's methods are events too, which the mod that added it answers.
      const wrapped = engine.interceptApi(plugin, { [noun]: value as Record<string, unknown> })
      byMod.set(plugin, wrapped[noun]!)
      nouns.set(noun, byMod)
    }
  }

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
      const past = (next: unknown, tier: TargetTier) => {
        if (!TIERS.includes(tier)) throw new Error(`next.to: no tier named ${String(tier)}`)
        // Every hook here is a mod's; a tier beneath theirs is the host's behaviour.
        const beyond = TIERS.indexOf(tier) > TIERS.indexOf(MOD_TIER)
        return (downstream ??= beyond
          ? Promise.resolve().then(() => core(next === undefined ? input : next))
          : run(event, chain, i + 1, next === undefined ? input : next, core, opts))
      }
      const makeNext = (pause: <T>(p: Promise<T>) => Promise<T>, extra = {}): Next =>
        Object.assign((next?: unknown) => pause(rest(next)), {
          to: (next: unknown, tier: TargetTier) => pause(past(next, tier)),
          signal,
          origin: opts.origin ?? CORE,
          budget: { ms: budgetMs, remainingMs: budgetMs },
          ...extra,
        }) as Next
      const api = apiFor(entry.plugin, opts.plugins)
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
      if (added.some((entry) => matchesEventName(entry.pattern, 'engine.create')))
        try {
          await create(plugin)
        } catch (error) {
          engine.unload(plugin)
          throw error instanceof ModLoadError ? error : new ModLoadError(failureOf(error).message)
        }
      return [...new Set(added.map((entry) => entry.pattern))]
    },

    unload(plugin: string): void {
      hooks = hooks.filter((entry) => entry.plugin !== plugin)
      apis.delete(plugin)
      for (const [noun, byMod] of nouns) if (byMod.delete(plugin) && !byMod.size) nouns.delete(noun)
    },

    plugins(): string[] {
      return [...apis.keys()]
    },

    /** The API a mod's hooks receive, for calls the host makes on its behalf. */
    apiOf(plugin: string): ModsApi | undefined {
      return apis.has(plugin) ? apiFor(plugin) : undefined
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
      opts: DispatchOptions = {},
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

    /**
     * Every method of `api` becomes an event other mods may hook (`fs.read`, `ui.toast`), and
     * answers as Claude Code's does (`intercept.ts`).
     */
    interceptApi(plugin: string, api: ModsApi): ModsApi {
      const peersOf = options.peersOf
      return interceptApi(engine, plugin, api, peersOf ? () => peersOf(plugin) : undefined)
    },
  }
  return engine
}

export type ModsEngine = ReturnType<typeof createModsEngine>

function failureOf(error: unknown): HookFailure {
  if (error instanceof HookTimeout) return { kind: 'timeout', message: 'ran out of time' }
  return { kind: 'throw', message: error instanceof Error ? error.message : String(error) }
}
