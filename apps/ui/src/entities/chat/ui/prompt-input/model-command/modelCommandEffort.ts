import { resolveCommandSpec } from '@localixai/api/slash-catalog'
import { parseCommandArgs, type SlashArgOption, type SlashArgSpec } from '../SlashArgSpec'
import { resolveLiveTaskModel } from '../model-select/taskReasoning'
import { modelReasoningOptions } from '../../../model/modelReasoning'
import { modelStepOptions } from './modelCommandSteps'
import { resolveModelCommand, type ModelCommandPlan } from './modelCommandPlan'
import { targetSlot, type ModelCommandContext } from './modelCommandTarget'

/**
 * `/effort` is `/model` entered at its reasoning step: the level is asked, and the connection and
 * model are the ones the conversation's agent already runs on. Rows come from `/model`'s own step
 * builder and Enter goes through `/model`'s own plan (`resolveModelCommand`), so the levels shown
 * and the write made cannot differ from `/model`'s.
 */

/** The connection and model the agent runs now, as `/model` resolves a route. */
function liveRoute(context: ModelCommandContext) {
  const live = resolveLiveTaskModel(context.models, context.connections, targetSlot(context))
  return live ? { model: live.model, connectionId: live.connection.id } : null
}

/** `/model`'s committed steps for that route, which its reasoning step reads. */
function modelSteps(context: ModelCommandContext) {
  const route = liveRoute(context)
  return route ? { provider: route.connectionId, model: route.model.id } : null
}

export function skipEffortStep(context: ModelCommandContext, name: string): boolean {
  if (name === 'agent') return true
  return !liveRoute(context)?.model.supportsReasoning
}

export function effortStepOptions(
  context: ModelCommandContext,
  name: string,
  query: string,
): SlashArgOption[] {
  if (name === 'agent') return []
  const steps = modelSteps(context)
  return steps ? modelStepOptions(context, 'reasoning', query, steps) : []
}

/** The typed `/effort` as `/model`'s plan, or what is missing for one. */
export function resolveEffortCommand(
  context: ModelCommandContext,
  text: string,
  specs: readonly SlashArgSpec[],
): { plan: ModelCommandPlan } | { error: string } {
  const parsed = parseCommandArgs(text, specs, (name) => skipEffortStep(context, name))
  const committed = new Map(parsed.chips.map((chip) => [chip.spec.name, chip.option.value]))
  const tail = parsed.activeText.trim()
  if (parsed.activeSpec && tail && !/\s/.test(tail)) committed.set(parsed.activeSpec.name, tail)
  const { agent } = context
  if (!agent) return { error: 'This chat has no agent yet.' }
  const route = liveRoute(context)
  if (!route) return { error: `${agent.name} has no model to set a level on.` }
  if (!route.model.supportsReasoning)
    return { error: `${route.model.name} does not offer reasoning levels.` }
  const level = committed.get('reasoning')
  if (!level) return { error: 'Pick a reasoning level.' }
  if (!modelReasoningOptions(route.model.reasoningEfforts).some((option) => option.value === level))
    return { error: `${route.model.name} does not offer the level “${level}”.` }
  const plan = resolveModelCommand(
    context,
    `${route.connectionId} ${route.model.id} ${level}`,
    resolveCommandSpec('model')?.args ?? [],
  )
  return plan ? { plan } : { error: `Could not set “${level}” on ${route.model.name}.` }
}
