import type { ModsApi } from './intercept'
import type { Matcher } from './matcher'

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

export interface Next {
  (event?: unknown): Promise<unknown>
  readonly signal: AbortSignal
  readonly origin: HookOrigin
  readonly budget: { readonly ms: number; readonly remainingMs: number }
  /**
   * Past the rest of this tier: the chain goes on at the first hook of `tier` or a tier beneath
   * it (`append`, `builtin`, `core`). Every mod a person installs is `user`; Localix has no
   * managed or bundled mods, so past the user tier is the host's own behaviour.
   */
  readonly to: (event: unknown, tier: TargetTier) => Promise<unknown>
  /** In a `.catch` handler: why the hook failed, and whether it had called `next`. */
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
