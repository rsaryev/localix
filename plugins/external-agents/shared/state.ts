/**
 * The lifecycle state model for a live external agent, and the rule about who is allowed to
 * author it.
 *
 * These are the states a caller can actually act on.
 */

export const AGENT_STATES = ['working', 'blocked', 'idle', 'done', 'unknown'] as const
export type AgentState = (typeof AGENT_STATES)[number]

/**
 * WHO decided the state. The central rule: an agent kind has exactly ONE status authority at a
 * time — lifecycle reports when the integration is installed and reporting, otherwise screen
 * detection, and never also the screen manifest fallback for that same lifecycle authority. This
 * avoids two competing sources of truth.
 *
 * The authorities:
 *  - `screen-manifest` — classify the rendered terminal snapshot against the agent kind's
 *                        declarative manifest.
 *  - `transcript`      — the agent's OWN append-only log, consulted only when the manifest
 *                        degraded to its idle fallback. It cannot see a permission prompt (nothing
 *                        is written while one waits), so it never overrides a matched rule — it
 *                        answers the one question the fallback cannot: is a turn still running.
 *  - `none`            — no live terminal: a historical session on disk.
 *
 * There is deliberately NO lifecycle authority. A delegation used to claim one by REPORTING its own
 * state through a webhook protocol injected into its prompt, and that is gone: it required the
 * foreign agent to cooperate, so an agent that ignored the instruction produced silence
 * indistinguishable from work. Claude Code and Codex are screen-manifest agents, because their own
 * hooks can miss permission approval results, escape interrupts, or other transitions.
 */
export const STATE_AUTHORITIES = ['screen-manifest', 'transcript', 'none'] as const
export type StateAuthority = (typeof STATE_AUTHORITIES)[number]

/**
 * The label used when a KNOWN agent's screen matches no rule: blocked detection is strict, and an
 * unrecognized screen degrades to `idle` and SAYS so rather than guessing `blocked`.
 */
export const IDLE_FALLBACK_REASON = 'default_known_agent_idle_fallback'

/** Why the state is what it is. Every field here exists to be shown to a human or a model. */
export interface StateExplain {
  readonly state: AgentState
  readonly authority: StateAuthority
  /** Manifest rule id that matched, when the authority is `screen-manifest`. */
  readonly matchedRule?: string
  /** Manifest that was evaluated, and its version — so a wrong answer is traceable to data. */
  readonly manifestId?: string
  readonly manifestVersion?: number
  /** True when a user-supplied override manifest shadowed the bundled one. */
  readonly manifestOverridden?: boolean
  /** Set when no rule matched; carries IDLE_FALLBACK_REASON. */
  readonly fallbackReason?: string
  /** Human sentence, always populated. */
  readonly summary: string
  readonly observedAt: number
}
