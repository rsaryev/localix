import { agentModelSettingsFor } from '@localixai/agent'
import type { SlashArgOption } from '../SlashArgSpec'
import { modelReasoningOptions } from '../../../model/modelReasoning'
import { filterModels } from '../model-select/filterModels'
import {
  contextLimitOptions,
  inheritedMaxTurns,
  maxTurnsChoices,
  maxTurnsLabel,
} from '../model-select/modelSettingChoices'
import { resolveLiveTaskModel } from '../model-select/taskReasoning'
import {
  connectionModel,
  startReasoning,
  targetSlot,
  type ModelCommandContext,
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
 * Which steps do not apply — exactly where the picker shows no such control: the agent is the
 * conversation's own and is never asked for, Reasoning for a model that does not reason, and
 * Context limit for a model whose Auto already is its whole window (the picker shows no such row
 * there).
 */
export function skipModelStep(
  context: ModelCommandContext,
  name: string,
  committed: ReadonlyMap<string, string>,
): boolean {
  if (name === 'agent') return true
  if (name === 'reasoning') {
    const model = connectionModel(context, committed.get('provider'), committed.get('model'))
    return model !== undefined && !model.supportsReasoning
  }
  if (name === 'context') {
    const model = connectionModel(context, committed.get('provider'), committed.get('model'))
    return model !== undefined && !contextLimitOptions(model.contextLength).adjustable
  }
  return false
}

function currentConnectionId(context: ModelCommandContext) {
  const live = resolveLiveTaskModel(context.models, context.connections, targetSlot(context))
  return live?.connection.id ?? null
}

/** The rows of one step, given what is committed before it and the text typed into it. */
export function modelStepOptions(
  context: ModelCommandContext,
  name: string,
  query: string,
  committed: Readonly<Record<string, string>>,
): SlashArgOption[] {
  if (name === 'provider') {
    const current = currentConnectionId(context)
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
    const slot = targetSlot(context)
    return filterModels([...context.models], connection.providerId, query)
      .slice(0, MAX_ROWS)
      .map((model) => ({
        value: model.id,
        label: model.name,
        description: `${model.id}${slot?.modelId === model.id ? ' · current' : ''}`,
      }))
  }
  const model = connectionModel(context, committed.provider, committed.model)
  const { agent } = context
  if (!model || !agent) return []
  if (name === 'reasoning') {
    const start = startReasoning(context, model)
    return modelReasoningOptions(model.reasoningEfforts)
      .filter((option) => matches(query, option.label, option.value))
      .map((option) => ({
        value: option.value,
        label: option.label,
        description: `${option.description}${option.value === start ? ' · current' : ''}`,
      }))
  }
  const entry = agentModelSettingsFor(
    context.agentModelSettings,
    agent.agentId,
    model.providerId,
    model.id,
  )
  if (name === 'turns') {
    const inherited = inheritedMaxTurns(context.maxTurns, agent.maxTurnsLimit)
    const { current, options } = maxTurnsChoices(entry?.maxTurns, inherited, agent.maxTurnsLimit)
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
    const { options, selected } = contextLimitOptions(model.contextLength, entry?.contextLimit)
    return [
      {
        value: KEEP,
        label: `Keep ${selected.label}`,
        description: 'Leave the context limit as it is',
      },
      ...options.map((option) => ({
        // Auto is the default: choosing it clears the stored limit, as the picker's Auto does.
        value: option.value === undefined ? USE_DEFAULT : option.arg,
        label: option.label,
        ...(option.value === undefined ? { description: 'Default for this model' } : {}),
      })),
    ].filter((row) => matches(query, row.label, row.value))
  }
  return []
}
