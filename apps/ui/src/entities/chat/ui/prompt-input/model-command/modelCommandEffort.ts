import { resolveCommandSpec } from '@localixai/api/slash-catalog'
import { parseCommandArgs, type SlashArgOption, type SlashArgSpec } from '../SlashArgSpec'
import { resolveLiveTaskModel } from '../model-select/taskReasoning'
import { modelReasoningOptions } from '../../../model/modelReasoning'
import { agentOptions, modelStepOptions } from './modelCommandSteps'
import { resolveModelCommand, type ModelCommandPlan } from './modelCommandPlan'
import {
  ALL_AGENTS,
  targetSlot,
  type ModelCommandContext,
  type ModelCommandTarget,
} from './modelCommandTarget'
import type { ParticipantRow } from '../model-select/ModelTaskColumn'

/**
 * `/effort` is `/model` entered at its reasoning step: the agent and the level are asked, and the
 * connection and model are the ones that agent already runs on. Rows come from `/model`'s own
 * step builder and Enter goes through `/model`'s own plan (`resolveModelCommand`), so the levels
 * shown and the write made cannot differ from `/model`'s.
 */

/** Who is in the chat. Agents that could join have no seat to set a level on. */
const seated = (context: ModelCommandContext): ParticipantRow[] =>
  context.participants.filter((row) => row.invited !== false)

/** The agent a command names, or the only one there is. */
function targetMember(context: ModelCommandContext, agent: string | undefined) {
  const members = seated(context)
  if (!agent) return members.length === 1 ? members[0] : undefined
  const handle = agent.replace(/^@/, '').toLowerCase()
  return members.find((row) => row.handle.toLowerCase() === handle)
}

/** The connection and model the agent runs now, as `/model` resolves a route. */
function liveRoute(context: ModelCommandContext, member: ParticipantRow) {
  const target: ModelCommandTarget = { kind: 'agent', member }
  const live = resolveLiveTaskModel(
    context.models,
    context.connections,
    targetSlot(context, target),
  )
  return live ? { model: live.model, connectionId: live.connection.id } : null
}

/** `/model`'s committed steps for that route, which its reasoning step reads. */
function modelSteps(context: ModelCommandContext, agent: string | undefined) {
  const member = targetMember(context, agent)
  const route = member && liveRoute(context, member)
  return member && route
    ? { agent: `@${member.handle}`, provider: route.connectionId, model: route.model.id }
    : null
}

export function skipEffortStep(
  context: ModelCommandContext,
  name: string,
  committed: ReadonlyMap<string, string>,
): boolean {
  if (name === 'agent') return seated(context).length <= 1
  const member = targetMember(context, committed.get('agent'))
  return !member || !liveRoute(context, member)?.model.supportsReasoning
}

export function effortStepOptions(
  context: ModelCommandContext,
  name: string,
  query: string,
  committed: Readonly<Record<string, string>>,
): SlashArgOption[] {
  if (name === 'agent') {
    const members = new Set(seated(context).map((row) => `@${row.handle}`))
    return agentOptions(context, query).filter(
      (row) => row.value !== ALL_AGENTS && members.has(row.value),
    )
  }
  const steps = modelSteps(context, committed.agent)
  return steps ? modelStepOptions(context, 'reasoning', query, steps) : []
}

/** The typed `/effort` as `/model`'s plan, or what is missing for one. */
export function resolveEffortCommand(
  context: ModelCommandContext,
  text: string,
  specs: readonly SlashArgSpec[],
): { plan: ModelCommandPlan } | { error: string } {
  const parsed = parseCommandArgs(text, specs, (name, committed) =>
    skipEffortStep(context, name, committed),
  )
  const committed = new Map(parsed.chips.map((chip) => [chip.spec.name, chip.option.value]))
  const tail = parsed.activeText.trim()
  if (parsed.activeSpec && tail && !/\s/.test(tail)) committed.set(parsed.activeSpec.name, tail)
  const member = targetMember(context, committed.get('agent'))
  if (!member) return { error: 'Pick an agent first.' }
  const route = liveRoute(context, member)
  if (!route) return { error: `@${member.handle} has no model to set a level on.` }
  if (!route.model.supportsReasoning)
    return { error: `${route.model.name} does not offer reasoning levels.` }
  const level = committed.get('reasoning')
  if (!level) return { error: 'Pick a reasoning level.' }
  if (!modelReasoningOptions(route.model.reasoningEfforts).some((option) => option.value === level))
    return { error: `${route.model.name} does not offer the level “${level}”.` }
  const plan = resolveModelCommand(
    context,
    `@${member.handle} ${route.connectionId} ${route.model.id} ${level}`,
    resolveCommandSpec('model')?.args ?? [],
  )
  return plan ? { plan } : { error: `Could not set “${level}” on ${route.model.name}.` }
}
