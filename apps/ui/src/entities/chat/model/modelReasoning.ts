/**
 * Which reasoning levels a model offers, and what a stored level becomes on it.
 *
 * The rule itself is shared with the server (`@localixai/agent` `reasoning-levels.ts`): the
 * picker, `/model`, the agent editor and the server's route writes all
 * clamp through it, so what the picker shows is what the server stores and the request carries.
 */
export {
  clampModelReasoning,
  defaultModelReasoning,
  initialModelReasoning,
  modelReasoningOptions,
  reasoningOnModel,
} from '@localixai/agent'
