import { agentModelSettingsFor } from '@localixai/agent'
import type { SlashArgOption } from '../SlashArgSpec'
import { modelReasoningOptions } from '../../../model/modelReasoning'
import { filterModels } from '../model-select/filterModels'
import {
  contextPercentChoices,
  contextPercentLabel,
  inheritedMaxTurns,
  maxTurnsChoices,
  maxTurnsLabel,
} from '../model-select/modelSettingChoices'
import { levelLabel, partyStatusText, summarizeParty } from '../model-select/partyRoute'
import { resolveLiveTaskModel } from '../model-select/taskReasoning'
import {
  ALL_AGENTS,
  commandTarget,
  connectionModel,
  hasAgentStep,
  startReasoning,
  targetSlot,
  type ModelCommandContext,
  type ModelCommandTarget,
} from './modelCommandTarget'

/** Settings steps: leave the value as it is, or clear it back to the inherited default. */
export const KEEP = 'keep'
export const USE_DEFAULT = 'default'

const MAX_ROWS = 50
const matches = (query: string, ...texts: (string | undefined)[]) => {
  const q = query.trim().replace(/^@/, '').toLowerCase()
  return !q || texts.some((text) => text?.toLowerCase().includes(q))
}

/**
 * Which steps do not apply — exactly where the picker shows no such column or control: Agents in
 * a one-agent chat, Reasoning for a model that does not reason, and Turns / Context window for
 * "All agents" (the picker offers those for one participant only).
 */
export function skipModelStep(
  context: ModelCommandContext,
  name: string,
  committed: ReadonlyMap<string, string>,
): boolean {
  if (name === 'agent') return !hasAgentStep(context)
  if (name === 'reasoning') {
    const model = connectionModel(context, committed.get('provider'), committed.get('model'))
    return model !== undefined && !model.supportsReasoning
  }
  if (name === 'turns' || name === 'context') return committed.get('agent') === ALL_AGENTS
  return false
}

function agentOptions(context: ModelCommandContext, query: string): SlashArgOption[] {
  const { participants, models, connections, sessionConnectionId } = context
  const nameOf = (target: ModelCommandTarget) => {
    const live = resolveLiveTaskModel(models, connections, targetSlot(context, target))
    return live?.model.name ?? null
  }
  const party = summarizeParty(participants, sessionConnectionId)
  const all: SlashArgOption = {
    value: ALL_AGENTS,
    label: 'All agents',
    description: partyStatusText(party, nameOf({ kind: 'party', members: participants })),
  }
  const members = participants.map((member) => {
    const slot = targetSlot(context, { kind: 'agent', member })
    const name = nameOf({ kind: 'agent', member })
    return {
      value: `@${member.handle}`,
      label: member.label ?? `@${member.handle}`,
      description: name
        ? `${name} · ${levelLabel(slot?.reasoningEffort ?? 'medium')}`
        : (member.inheritedLabel ?? 'Not set'),
    }
  })
  return [all, ...members].filter((row) => matches(query, row.label, row.value))
}

function currentConnectionId(context: ModelCommandContext, target: ModelCommandTarget | null) {
  if (!target) return null
  const live = resolveLiveTaskModel(
    context.models,
    context.connections,
    targetSlot(context, target),
  )
  return live?.connection.id ?? null
}

/** The rows of one step, given what is committed before it and the text typed into it. */
export function modelStepOptions(
  context: ModelCommandContext,
  name: string,
  query: string,
  committed: Readonly<Record<string, string>>,
): SlashArgOption[] {
  if (name === 'agent') return agentOptions(context, query)
  const target = commandTarget(context, committed.agent)
  if (name === 'provider') {
    const current = currentConnectionId(context, target)
    return context.connections
      .filter((connection) => matches(query, connection.label, connection.providerId))
      .map((connection) => ({
        value: connection.id,
        label: connection.label,
        description: `${connection.providerId}${connection.id === current ? ' · current' : ''}`,
      }))
  }
  const connection = context.connections.find((row) => row.id === committed.provider)
  if (name === 'model') {
    if (!connection) return []
    const slot = target ? targetSlot(context, target) : null
    return filterModels([...context.models], connection.providerId, query)
      .slice(0, MAX_ROWS)
      .map((model) => ({
        value: model.id,
        label: model.name,
        description: `${model.id}${slot?.modelId === model.id ? ' · current' : ''}`,
      }))
  }
  const model = connectionModel(context, committed.provider, committed.model)
  if (!model || !target) return []
  if (name === 'reasoning') {
    const start = startReasoning(context, target, model)
    return modelReasoningOptions(model.reasoningEfforts)
      .filter((option) => matches(query, option.label, option.value))
      .map((option) => ({
        value: option.value,
        label: option.label,
        description: `${option.description}${option.value === start ? ' · current' : ''}`,
      }))
  }
  if (target.kind !== 'agent') return []
  const entry = agentModelSettingsFor(
    context.agentModelSettings,
    target.member.agentId,
    model.providerId,
    model.id,
  )
  if (name === 'turns') {
    const inherited = inheritedMaxTurns(context.maxTurns, target.member.maxTurnsLimit)
    const { current, options } = maxTurnsChoices(
      entry?.maxTurns,
      inherited,
      target.member.maxTurnsLimit,
    )
    return [
      {
        value: KEEP,
        label: `Keep ${maxTurnsLabel(current)}`,
        description: 'Leave turns as they are',
      },
      { value: USE_DEFAULT, label: 'Use default', description: maxTurnsLabel(inherited) },
      ...options.map((step) => ({ value: String(step), label: maxTurnsLabel(step) })),
    ].filter((row) => matches(query, row.label, row.value))
  }
  if (name === 'context') {
    const { current, options, defaultValue } = contextPercentChoices(entry?.contextPercent)
    return [
      {
        value: KEEP,
        label: `Keep ${contextPercentLabel(current)}`,
        description: 'Leave the context window share as it is',
      },
      { value: USE_DEFAULT, label: 'Use default', description: contextPercentLabel(defaultValue) },
      ...options.map((step) => ({ value: `${step}%`, label: contextPercentLabel(step) })),
    ].filter((row) => matches(query, row.label, row.value))
  }
  return []
}
