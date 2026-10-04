import type { ModelRoutingTaskKey } from '@localixai/api/client'

/**
 * WHAT THE MODEL PICKER IS CHOOSING FOR.
 *
 * Two kinds of thing, and they persist to different places.
 *
 *   - A WORKLOAD (`titleGeneration`, …) is a global route stored under
 *     `agentSettings.modelRouting`. There is a fixed catalog of them.
 *   - A PARTICIPANT of the open conversation is stored on that conversation, as the route of
 *     one agent inside it. There is no catalog: the party is whatever the session says it is.
 *
 * The participant case is spelled `agent:<id>`. The route update is keyed by agent ID;
 * the display handle must never be passed as that ID. The prefix keeps targets distinct
 * from workload keys, which are bare words.
 *
 * Nothing here knows a particular handle, or whether the conversation has one participant or
 * seven. A private chat is a party of one, not a special case.
 */
export type PickerTarget = ModelRoutingTaskKey | `agent:${string}`

const AGENT_PREFIX = 'agent:'

export const agentTarget = (agentId: string): PickerTarget => `${AGENT_PREFIX}${agentId}`

/** The stable agent ID this target names, or null for a global workload. */
export function targetAgentId(target: PickerTarget): string | null {
  return target.startsWith(AGENT_PREFIX) ? target.slice(AGENT_PREFIX.length) : null
}

/**
 * Does this target write to the conversation rather than to global settings?
 *
 * The predicate the routing hook branches on. It replaces a `key === 'session'` check that
 * could only ever describe a chat with one counterpart.
 */
export const isAgentTarget = (target: PickerTarget): boolean => targetAgentId(target) !== null

/**
 * The global-settings key this target writes to, or null when it writes to the conversation.
 *
 * `session` maps to null on purpose: it is the reasoning-memory bucket, not a workload route,
 * and the routes record has no assignment to store for it.
 */
export function workloadKey(target: PickerTarget): Exclude<ModelRoutingTaskKey, 'session'> | null {
  if (isAgentTarget(target) || target === 'session') return null
  return target as Exclude<ModelRoutingTaskKey, 'session'>
}

/**
 * Where this target's per-MODEL reasoning memory lives.
 *
 * Participants share the `session` bucket: remembering "gpt-5.6 on high" is a preference about
 * a model, not about who runs it, so a second agent picking the same model inherits the choice
 * rather than starting from the flat default.
 */
export function reasoningMemoryKey(target: PickerTarget): ModelRoutingTaskKey {
  return isAgentTarget(target) ? 'session' : (target as ModelRoutingTaskKey)
}

export type ModelPickDestination =
  | { kind: 'conversation'; agentId?: string }
  | { kind: 'workload'; key: Exclude<ModelRoutingTaskKey, 'session'> }

/**
 * Turn the picker's display target into an exhaustive persistence strategy.
 *
 * `session` used to fall between an agent branch and a workload branch, where its null workload
 * key silently discarded the selection. A discriminated result makes that impossible: every
 * target is either a direct conversation pick or a global workload write.
 */
export function modelPickDestination(target: PickerTarget): ModelPickDestination {
  const agentId = targetAgentId(target)
  if (agentId !== null) return { kind: 'conversation', agentId }
  if (target === 'session') return { kind: 'conversation' }
  const key = workloadKey(target)
  if (!key) throw new Error(`Picker target has no persistence strategy: ${target}`)
  return { kind: 'workload', key }
}
