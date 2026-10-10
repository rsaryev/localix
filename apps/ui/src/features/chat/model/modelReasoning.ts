import {
  DEFAULT_REASONING_EFFORT,
  REASONING_EFFORT_OPTIONS,
  type ReasoningEffort,
} from '@localixai/agent'

/**
 * Which reasoning levels a given model actually offers, and what to do with a preference for
 * one it does not.
 *
 * A preference is stored per provider/model pair and outlives the model it was chosen for: pick
 * a model that reasons less finely and the old level is still there. The runtime clamps it (as
 * pi does), so nothing breaks — but a picker that keeps offering the level, and a chip that
 * keeps naming it, are describing a request the model will never receive.
 *
 * So the capability travels with the model (`CatalogModel.reasoningEfforts`, pi's
 * `getSupportedThinkingLevels`), and these two functions are the only readers of it: one for
 * what to OFFER, one for what a stored preference BECOMES. The clamp walks the canonical scale
 * upward first, then down — thinking a little more than asked is closer to the intent than
 * thinking less.
 */

/** `off` is every model's floor and is never published as a capability. */
const OFF: ReasoningEffort = 'off'

const SCALE: ReasoningEffort[] = REASONING_EFFORT_OPTIONS.map((option) => option.value).filter(
  (value) => value !== OFF,
)

function supported(efforts: readonly string[] | undefined): ReasoningEffort[] {
  // An unknown/absent list means "not published" — offer the whole scale rather than pretending
  // the model can do nothing. A model that truly reasons at no level publishes an EMPTY list.
  if (!efforts) return SCALE
  return SCALE.filter((level) => efforts.includes(level))
}

/** The options to show for this model: `off` first, then only the levels it offers. */
export function modelReasoningOptions(
  efforts: readonly string[] | undefined,
): typeof REASONING_EFFORT_OPTIONS {
  const offered = new Set<string>(supported(efforts))
  return REASONING_EFFORT_OPTIONS.filter(
    (option) => option.value === OFF || offered.has(option.value),
  )
}

/**
 * The level this model will actually be asked for, given a stored preference. Mirrors the
 * runtime's clamp, so what the picker shows is what the request carries.
 */
export function clampModelReasoning(
  effort: ReasoningEffort | undefined,
  efforts: readonly string[] | undefined,
): ReasoningEffort | undefined {
  if (effort === undefined || effort === OFF) return effort
  const offered = supported(efforts)
  if (offered.length === 0) return OFF
  if (offered.includes(effort)) return effort
  const index = SCALE.indexOf(effort)
  if (index === -1) return offered[0]
  for (let i = index + 1; i < SCALE.length; i += 1) {
    const candidate = SCALE[i]!
    if (offered.includes(candidate)) return candidate
  }
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = SCALE[i]!
    if (offered.includes(candidate)) return candidate
  }
  return OFF
}

/**
 * The level a model with no memory of its own inherits.
 *
 * `off` is where a model that cannot reason lands, not a level anyone chose to carry. Treating
 * it as one is what painted the whole picker "Off": pick a non-reasoning model once, and the
 * session's `off` became the inherited level for every other row — and was written into each
 * model's memory as it was picked, permanently. pi draws the same line at the same seam
 * (`_getThinkingLevelForModelSwitch`): when the current model does not think, carry the
 * default, not the current level.
 */
export function carriedReasoningEffort(
  sessionEffort: ReasoningEffort | undefined,
  remembered: ReasoningEffort | null,
): ReasoningEffort {
  if (sessionEffort && sessionEffort !== OFF) return sessionEffort
  return remembered ?? DEFAULT_REASONING_EFFORT
}
