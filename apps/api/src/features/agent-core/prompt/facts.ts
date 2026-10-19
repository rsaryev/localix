/**
 * THE FACTS A PROMPT IS RENDERED FROM, derived once per render.
 *
 * Sections used to derive their own: whether colleagues share the room was computed twice in the
 * builder and once more in the roster, whether a tag can invite had two defaults that agreed only
 * because no host left the field out, and the leader default differed between the collaboration
 * rule and the turn contract. Each is answered here, once, and every section reads the answer.
 *
 * The host's policy (`chat/policy`) decides these for a chat; this module only normalizes what the
 * host passed, so the agent-agnostic core never reaches back into a host to ask.
 */
import { CHAT_RUN_PROFILE, type RunProfile } from '../run-shape'
import { TOOL } from '../tool-names'
import { createRuntimeToolRegistry, type RuntimeToolRegistry } from '../tool-registry'
import type { BuildAgentSystemPromptParams } from './contracts'
import { isMultiAgentConversation } from './sections/conversation'
import { rendersAnswerMarkdown } from './sections/answer-format'

/** The task board plugin's tool; its rules join the turn contract only when the run holds it. */
export const TASK_BOARD_TOOL = 'kanban'

export interface RoomFacts {
  /** A conversation exists for this run. Every production run has one. */
  inConversation: boolean
  /** Someone besides the speaker is in it. */
  withColleagues: boolean
  /** A tag can bring an available agent in. */
  canInvite: boolean
  /** The speaker leads: alone, a lone agent leads by default. */
  isLeader: boolean
  /** The speaker may set the session objective, and holds the tool to do it. */
  canChangeTopic: boolean
}

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
  room: RoomFacts
}

export function promptFacts(params: BuildAgentSystemPromptParams): PromptFacts {
  const registry = params.toolRegistry ?? createRuntimeToolRegistry()
  const profile = params.agentProfile ?? CHAT_RUN_PROFILE
  const hasTool = (name: string) => registry.toolNames.includes(name)
  const conversation = params.conversation
  const withColleagues = isMultiAgentConversation(conversation)
  return {
    params,
    profile,
    registry,
    hasTool,
    rendersAnswers: rendersAnswerMarkdown(profile.shape, params.deliveryContext?.channel),
    room: {
      inConversation: conversation !== undefined,
      withColleagues,
      canInvite: conversation !== undefined && !(conversation.membershipClosed ?? false),
      isLeader: conversation?.isLeader ?? !withColleagues,
      canChangeTopic: (params.canChangeTopic ?? false) && hasTool(TOOL.set_topic),
    },
  }
}
