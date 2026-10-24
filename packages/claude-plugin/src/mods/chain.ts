import type { ModsApi } from './intercept'
import type { Matcher } from './matcher'
import type { TraceEntry } from './trace'

/**
 * The shapes of the chain a mod's hooks form: what `on` registers, what a hook receives as
 * `next`, and the tiers Claude Code's engine nests hooks in.
 */

export interface HookFailure {
  kind: 'throw' | 'timeout'
  message: string
}

export interface HookOrigin {
  plugin: string
  tier: 'user' | 'core'
}

/**
 * What `next(e)` returns on a streaming event (`turn.step`): the stream of everything beneath,
 * chunk by chunk, returning the result from beneath. `yield* next(e)` forwards the chunks and
 * evaluates to that result; `await next(e)` (it is thenable) and `.result` read the result alone.
 */
export type HookStream = AsyncGenerator<unknown, unknown, unknown> &
  PromiseLike<unknown> & { readonly result: Promise<unknown> }

export interface Next {
  /**
   * Runs the rest of the chain and then the host. Each call runs what is beneath afresh (a retry
   * re-runs it); on a streaming event it is a HookStream.
   */
  (event?: unknown): Promise<unknown> | HookStream
  readonly signal: AbortSignal
  readonly origin: HookOrigin
  /** This dispatch's event, by name. */
  readonly event: string
  /** Whether this dispatch's event is one `pattern` (a name, a glob, a negation) selects. */
  readonly is: (pattern: string, e?: unknown) => boolean
  /** What settled beneath on this hook's latest `next()`: a link per entry, nearest first. */
  readonly trace: readonly TraceEntry[]
  readonly budget: { readonly ms: number; readonly remainingMs: number }
  /**
   * Past the rest of this tier: the chain goes on at the first hook of `tier` or a tier beneath
   * it (`append`, `builtin`, `core`). Every mod a person installs is `user`; Localix has no
   * managed or bundled mods, so past the user tier is the host's own behaviour.
   */
  readonly to: (event: unknown, tier: TargetTier) => Promise<unknown> | HookStream
  /**
   * In a `.catch` handler: why the hook failed, and whether it had called `next`. There `next`
   * is replay-safe: when `called`, it answers what the hook's last call settled to without
   * running anything again; when not, it runs what is beneath once and later calls replay.
   */
  readonly error?: HookFailure
  readonly called?: boolean
}

/** The chain's tiers, outermost first, as Claude Code's engine nests them. */
export const TIERS = ['prepend', 'user', 'append', 'builtin', 'core'] as const
export type Tier = (typeof TIERS)[number]
/** What `next.to` may name: nothing skips to the tiers above a person's own. */
export type TargetTier = Exclude<Tier, 'prepend' | 'user'>
/** The tier a loaded mod's hooks stand in. */
export const MOD_TIER: Tier = 'user'

export type Hook = ($: ModsApi, event: unknown, next: Next) => unknown
export interface Registration {
  catch(handler: Hook): Registration
}
export type On = (event: string, matcherOrHook: Matcher | Hook, hook?: Hook) => Registration
export type RegisterFunction = (on: On, options: Record<string, unknown>) => unknown
