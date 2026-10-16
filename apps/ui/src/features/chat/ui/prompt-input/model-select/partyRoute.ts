import { REASONING_OPTIONS, type ReasoningEffort } from '../../../model/reasoning'
import type { ParticipantRow } from './ModelTaskColumn'
import type { ModelRoutingSlot } from './taskReasoning'

/**
 * THE "ALL AGENTS" ROW of the picker's Agents column — one model and level for the whole room.
 *
 * Each member of a group keeps its own route, and nothing makes one follow another: switching
 * the main agent to a stronger model leaves the others where they were. This row is the one
 * gesture that says "everyone, this model", and it only shows up when the room disagrees.
 */
export const PARTY_TARGET = 'party' as const

export interface PartySummary {
  /** Members in the room. */
  size: number
  /** Distinct models among members that have one. */
  models: number
  /** Distinct reasoning levels across the room. */
  levels: number
  /** The room's shared level, when there is one. */
  level?: ReasoningEffort
  /** Members with no model of their own. */
  unset: number
  /** Members whose model the catalog or connections can no longer serve. */
  unavailable: number
  /** The room's shared route when every member is on one model; null when they differ. */
  slot: ModelRoutingSlot
  /** Worth offering: a group whose members differ, or one with a member without a model. */
  relevant: boolean
}

export function summarizeParty(
  participants: readonly ParticipantRow[],
  sessionConnectionId: string | null,
  /** Whether a member's model resolves today; absent treats every model as available. */
  isAvailable: (slot: NonNullable<ModelRoutingSlot>) => boolean = () => true,
): PartySummary {
  const routed = participants.filter((member) => member.route?.modelId)
  const models = new Set(routed.map((member) => member.route!.modelId))
  const levels = new Set(participants.map((member) => member.route?.reasoningEffort ?? 'medium'))
  const unset = participants.length - routed.length
  const slots = routed.map((member) => ({
    providerConnectionId: member.route!.providerConnectionId ?? sessionConnectionId ?? '',
    modelId: member.route!.modelId,
  }))
  const unavailable = slots.filter((slot) => !isAvailable(slot)).length
  const shared = unset === 0 && models.size === 1 ? slots[0]! : null
  const level = levels.size === 1 ? [...levels][0] : undefined
  return {
    size: participants.length,
    models: models.size,
    levels: levels.size,
    ...(level ? { level } : {}),
    unset,
    unavailable,
    slot: shared
      ? {
          // A member whose seat names a connection decides it for the room.
          providerConnectionId:
            routed.find((member) => member.route?.providerConnectionId)?.route
              ?.providerConnectionId ?? shared.providerConnectionId,
          modelId: shared.modelId,
          ...(level ? { reasoningEffort: level } : {}),
        }
      : null,
    relevant:
      participants.length > 1 &&
      (models.size > 1 || levels.size > 1 || unset > 0 || unavailable > 0),
  }
}

/** A level as the picker names it (`High`). */
export const levelLabel = (effort: ReasoningEffort | undefined) =>
  REASONING_OPTIONS.find((option) => option.value === effort)?.label ?? effort ?? ''

/** The row's second line: what the room runs on now, said in words a screen reader reads too. */
export function partyStatusText(summary: PartySummary, modelLabel: string | null): string {
  if (summary.models === 0) return 'Not set'
  const parts = [
    summary.models > 1 ? `${summary.models} models` : modelLabel,
    summary.levels > 1 ? `${summary.levels} levels` : levelLabel(summary.level),
    summary.unset > 0 ? `${summary.unset} not set` : null,
    summary.unavailable > 0 ? `${summary.unavailable} unavailable` : null,
  ].filter(Boolean)
  const mixed = summary.models > 1 || summary.levels > 1 || summary.unset > 0
  return `${mixed ? 'Mixed · ' : ''}${parts.join(' · ')}`
}

/** Show the row when it is relevant, and keep it while it is the target being configured. */
export function showPartyRow(summary: PartySummary, active: boolean, canApply: boolean): boolean {
  return canApply && (summary.relevant || (active && summary.size > 1))
}
