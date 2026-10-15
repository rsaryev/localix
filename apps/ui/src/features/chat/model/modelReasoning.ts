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
 * The level a model runs at when nothing was chosen for it: the default, landed on a level this
 * model offers. `off` for a model that does not reason.
 */
export function defaultModelReasoning(
  supportsReasoning: boolean,
  efforts: readonly string[] | undefined,
): ReasoningEffort {
  if (!supportsReasoning) return OFF
  return clampModelReasoning(DEFAULT_REASONING_EFFORT, efforts) ?? OFF
}

/**
 * The level a model starts at when it is picked: what was last chosen for it, else its default.
 * Never the previous model's level — a pick must not depend on what was picked before it.
 */
export function initialModelReasoning(
  model: { supportsReasoning: boolean; reasoningEfforts?: readonly string[] },
  saved: ReasoningEffort | undefined,
): ReasoningEffort {
  if (!model.supportsReasoning) return OFF
  return (
    clampModelReasoning(saved, model.reasoningEfforts) ??
    defaultModelReasoning(true, model.reasoningEfforts)
  )
}
