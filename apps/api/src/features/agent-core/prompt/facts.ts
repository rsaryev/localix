/**
 * THE FACTS A PROMPT IS RENDERED FROM, derived once per render.
 *
 * Sections used to derive their own; each fact is answered here, once, and every section reads
 * the answer. This module only normalizes what the host passed, so the agent-agnostic core never
 * reaches back into a host to ask.
 */
import { CHAT_RUN_PROFILE, type RunProfile } from '../run-shape'
import { createRuntimeToolRegistry, type RuntimeToolRegistry } from '../tool-registry'
import type { BuildAgentSystemPromptParams } from './contracts'
import { rendersAnswerMarkdown } from './sections/answer-format'

/** The task board plugin's tool; its rules join the turn contract only when the run holds it. */
export const TASK_BOARD_TOOL = 'kanban'

export interface PromptFacts {
  params: BuildAgentSystemPromptParams
  /** The run's profile; a caller with none renders an ordinary chat's. */
  profile: RunProfile
  registry: RuntimeToolRegistry
  /**
   * Every prompt mention of a tool is gated on the REGISTRY, never on anything upstream of it: the
   * registry is the only place that knows what this run actually holds.
   */
  hasTool: (name: string) => boolean
  /** The transcript renders the answer forms (a chat, not relayed to a channel). */
  rendersAnswers: boolean
}

export function promptFacts(params: BuildAgentSystemPromptParams): PromptFacts {
  const registry = params.toolRegistry ?? createRuntimeToolRegistry()
  const profile = params.agentProfile ?? CHAT_RUN_PROFILE
  const hasTool = (name: string) => registry.toolNames.includes(name)
  return {
    params,
    profile,
    registry,
    hasTool,
    rendersAnswers: rendersAnswerMarkdown(profile.shape, params.deliveryContext?.channel),
  }
}
