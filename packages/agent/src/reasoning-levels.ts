import { DEFAULT_REASONING_EFFORT, REASONING_EFFORT_OPTIONS, type ReasoningEffort } from './types'

/**
 * WHICH REASONING LEVELS A MODEL OFFERS, AND WHAT A STORED LEVEL BECOMES ON IT — the one rule the
 * picker, `/model`, the "All agents" batch, the agent editor and the server's route writes share.
 *
 * The level list is the model's `CatalogModel.reasoningEfforts`, which the engine fills from the
 * catalog (`off` included exactly where the model can run without reasoning). The clamp below is
 * applied to that list, so the picker and the engine agree on what a stored level becomes.
 */

export interface ReasoningModel {
  /** Absent means "not published", which is treated as a reasoning model. */
  supportsReasoning?: boolean
  /** The levels the model publishes; absent = the whole scale, empty = `off` only. */
  reasoningEfforts?: readonly string[]
}

const OFF: ReasoningEffort = 'off'

/** `off`, then the canonical scale. */
const LEVELS: ReasoningEffort[] = REASONING_EFFORT_OPTIONS.map((option) => option.value)

function available(efforts: readonly string[] | undefined): ReasoningEffort[] {
  if (!efforts) return LEVELS
  const listed = LEVELS.filter((level) => efforts.includes(level))
  return listed.length > 0 ? listed : [OFF]
}

/** The options to show for this model, in scale order. */
export function modelReasoningOptions(
  efforts: readonly string[] | undefined,
): typeof REASONING_EFFORT_OPTIONS {
  const offered = new Set<string>(available(efforts))
  return REASONING_EFFORT_OPTIONS.filter((option) => offered.has(option.value))
}

/**
 * The level this model will actually be asked for, given a stored preference: the level itself if offered, else the nearest offered level upward, then
 * downward.
 */
export function clampModelReasoning(
  effort: ReasoningEffort | undefined,
  efforts: readonly string[] | undefined,
): ReasoningEffort | undefined {
  if (effort === undefined) return effort
  const offered = available(efforts)
  if (offered.includes(effort)) return effort
  const index = LEVELS.indexOf(effort)
  if (index === -1) return offered[0] ?? OFF
  const above = LEVELS.slice(index).find((level) => offered.includes(level))
  const below = LEVELS.slice(0, index)
    .reverse()
    .find((level) => offered.includes(level))
  return above ?? below ?? offered[0] ?? OFF
}

/**
 * The level an agent on `model` stores for a requested level. A model that does not reason is asked
 * for none, and the agent says so (`off`) — the picker and the server store the same answer.
 */
export function reasoningForModel(effort: ReasoningEffort, model: ReasoningModel): ReasoningEffort {
  if (model.supportsReasoning === false) return OFF
  return clampModelReasoning(effort, model.reasoningEfforts) ?? effort
}

/** The level a model runs at when nothing was chosen for it; `off` for a model that does not reason. */
export function defaultModelReasoning(
  supportsReasoning: boolean | undefined,
  efforts: readonly string[] | undefined,
): ReasoningEffort {
  return reasoningForModel(DEFAULT_REASONING_EFFORT, {
    supportsReasoning,
    reasoningEfforts: efforts,
  })
}

/**
 * The level a model starts at when it is picked: what was last chosen for it, else its default.
 * Never the previous model's level — a pick must not depend on what was picked before it.
 */
export function initialModelReasoning(model: ReasoningModel, saved: ReasoningEffort | undefined) {
  return reasoningForModel(saved ?? DEFAULT_REASONING_EFFORT, model)
}

/**
 * The level a target holds on `model` — the picker's `reasoningFor`, `/model` and the server's
 * switch, one rule: on the model the target runs on, its own level (`running`), clamped; on any
 * other model, the level last chosen for it there (`saved`), else the default.
 */
export function reasoningOnModel(
  model: ReasoningModel,
  running: ReasoningEffort | undefined,
  saved: ReasoningEffort | undefined,
): ReasoningEffort {
  return running !== undefined
    ? reasoningForModel(running, model)
    : initialModelReasoning(model, saved)
}

/** The level an agent holds after its model changes (`/model` on the server). */
export function effortForModelSwitch(args: {
  previous: { modelId: string; reasoningEffort: ReasoningEffort }
  next: { id: string } & ReasoningModel
  remembered?: ReasoningEffort
}): ReasoningEffort {
  const { previous, next, remembered } = args
  const running = previous.modelId === next.id ? previous.reasoningEffort : undefined
  return reasoningOnModel(next, running, remembered)
}
