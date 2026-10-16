import type { ReasoningEffort } from '@localixai/agent'

// ReasoningEffort is owned by @localixai/agent (the streaming layer defines the
// canonical level list); this module re-exports it plus chat-local presentation.
export { REASONING_EFFORT_OPTIONS as REASONING_OPTIONS, isReasoningEffort } from '@localixai/agent'
export type { ReasoningEffort }

export type ReasoningBeamIntensity = 0 | 1 | 2 | 3 | 4 | 5

/**
 * The beam has SIX steps (`LocalixBeamIntensity`, 0-5) and the effort scale now has seven, so the
 * top two levels share the strongest weight. Deliberate: the beam is decorative and its own
 * header asks callers not to invent another effect for it — `xhigh` and `max` are both "as much
 * thinking as this model offers", and inventing a 7th CSS step to tell them apart would add a
 * visual distinction the user cannot act on. The `satisfies` below is what forced this decision
 * into the open when `xhigh` was added.
 */
const REASONING_BEAM_INTENSITY = {
  off: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  max: 5,
} as const satisfies Record<ReasoningEffort, ReasoningBeamIntensity>

/** Stable visual weight for the existing composer border beam. */
export function reasoningBeamIntensity(effort: ReasoningEffort): ReasoningBeamIntensity {
  return REASONING_BEAM_INTENSITY[effort]
}
