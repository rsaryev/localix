import { useMemo } from 'react'
import type { ChatUsagePayload } from '@localixai/agent'
import type { TipSignal } from '@/shared/api/tips'
import type { ContextWindowDiagnostics } from './contextUsage'
import { useChatStore } from './store'
import { findSessionInState } from './findSession'
import { buildUsageIndicatorView } from './contextUsageView'

/**
 * The client's half of the tip contract: which named session facts hold RIGHT NOW.
 *
 * The server composes tips and says which fact each one needs (`TIP_SIGNALS`); it
 * cannot see the composer, so it cannot answer them. This module answers them, and
 * answers ONLY them — it resolves booleans, never text, so the pool keeps one author.
 *
 * Everything here is read from state the composer already holds. A signal that needed
 * its own request or its own poll would make the tip band cost more than the advice
 * it gives, and that is the trade this file exists to refuse.
 */

/** Turns of back-and-forth after which forking or pinning is real advice. */
const LONG_SESSION_MESSAGES = 40
/** Fraction of the context budget past which a context checkpoint is near. */
const CONTEXT_TIGHT_FRACTION = 0.7
/** Conversations a user has had before the product stops being new to them. */
const FIRST_SESSIONS = 3

export interface TipSignalInputs {
  sessionId: string | null
  /** The same usage inputs the context ring reads — see the note in `resolve`. */
  usage?: ChatUsagePayload
  contextDiagnostics?: ContextWindowDiagnostics
  contextWindow?: number
}

/** The measured facts, once, with no React around them. */
export interface TipFacts {
  queued: number
  loops: number
  monitors: number
  turns: number
  contextFraction: number | null
  sessionCount: number
}

/**
 * The thresholds, applied. Pure and exported so the judgement calls a tip depends on
 * — what counts as a long session, how full is nearly full — are pinned by tests
 * rather than only by whether the strip happened to render.
 */
export function resolveTipSignals(facts: TipFacts): ReadonlySet<TipSignal> {
  const signals = new Set<TipSignal>()
  if (facts.queued > 0) signals.add('queue-nonempty')
  if ((facts.contextFraction ?? 0) >= CONTEXT_TIGHT_FRACTION) signals.add('context-tight')
  if (facts.turns >= LONG_SESSION_MESSAGES) signals.add('session-long')
  if (facts.loops > 0) signals.add('loops-active')
  if (facts.monitors > 0) signals.add('monitors-active')
  // A zero here means the session list has not loaded yet, not that the user is new —
  // and "new user" advice shown to someone with two hundred sessions because their
  // workspace was still hydrating is exactly the wrong first impression.
  if (facts.sessionCount >= 1 && facts.sessionCount <= FIRST_SESSIONS) {
    signals.add('first-session')
  }
  return signals
}

export function useTipSignals(inputs: TipSignalInputs): ReadonlySet<TipSignal> {
  const session = useChatStore((state) => findSessionInState(state, inputs.sessionId))
  const sessionCount = useChatStore((state) => state.allSessions.length)

  const queued = session?.queuedMessages.length ?? 0
  const loops = session?.loops.length ?? 0
  const monitors = session?.work?.filter((item) => item.kind === 'monitor').length ?? 0
  const turns = Math.max(session?.messages.length ?? 0, session?.messageCount ?? 0)

  // The context fraction comes from the SAME builder the context ring renders, not a
  // second estimate: a tip that says the window is nearly full while the ring shows
  // half is worse than no tip at all, and two ways of dividing the same numbers is
  // how that happens.
  const contextFraction = useMemo(
    () =>
      buildUsageIndicatorView({
        usage: inputs.usage,
        contextDiagnostics: inputs.contextDiagnostics,
        contextWindow: inputs.contextWindow,
      }).fraction,
    [inputs.usage, inputs.contextDiagnostics, inputs.contextWindow],
  )

  return useMemo(
    () =>
      resolveTipSignals({
        queued,
        loops,
        monitors,
        turns,
        contextFraction,
        sessionCount,
      }),
    [queued, contextFraction, turns, loops, monitors, sessionCount],
  )
}
