import type { ContextLimit } from '@localixai/agent'
import { clampMaxTurns } from '@localixai/api/turn-budget'
import { parseCommandArgs, type SlashArgSpec } from '../SlashArgSpec'
import { isReasoningEffort, type ReasoningEffort } from '../../../model/reasoning'
import { modelReasoningOptions } from '../../../model/modelReasoning'
import {
  commandTarget,
  connectionModel,
  startReasoning,
  type ModelCommandContext,
} from './modelCommandTarget'
import { contextLimitOptions } from '../model-select/modelSettingChoices'
import { KEEP, skipModelStep, USE_DEFAULT } from './modelCommandSteps'

/**
 * What a completed `/model` does — the write the picker would make for the same choices:
 *   - one member: its seat route (`setModelSelection`) plus, when chosen, its per-model
 *     Turns / Context limit settings (`rememberAgentModelSettings`, as the details panel writes);
 *   - All agents: one batch route for the room (`applyPartyRoute`).
 * A setting is `null` to clear it back to the default and absent to leave it as it is.
 */
export type ModelCommandPlan =
  | {
      kind: 'agent'
      agentId: string
      connectionId: string
      modelId: string
      providerId: string
      reasoningEffort: ReasoningEffort
      settings: { maxTurns?: number | null; contextLimit?: ContextLimit | null }
    }
  | { kind: 'party'; connectionId: string; modelId: string; reasoningEffort: ReasoningEffort }

function settingValue(
  value: string | undefined,
  parse: (raw: string) => number | null,
): number | null | undefined {
  if (value === undefined || value === KEEP) return undefined
  if (value === USE_DEFAULT) return null
  return parse(value)
}

/** `keep` leaves it, `default`/`auto` clears it, an offered `400k`/`1m`/`full` sets it. */
function contextLimitValue(
  raw: string | undefined,
  contextWindow: number | undefined,
): ContextLimit | null | undefined | false {
  if (raw === undefined || raw === KEEP) return undefined
  const arg = raw.trim().toLowerCase()
  if (arg === USE_DEFAULT || arg === 'auto') return null
  const option = contextLimitOptions(contextWindow).options.find((row) => row.arg === arg)
  return option && option.value !== undefined ? option.value : false
}

/**
 * Resolve the typed `/model` text into the picker's write, or null when it is not a complete
 * step-by-step selection (no live connection + model). A null leaves the command to the server,
 * which keeps `/model <name>` working on every surface.
 */
export function resolveModelCommand(
  context: ModelCommandContext,
  text: string,
  specs: readonly SlashArgSpec[],
): ModelCommandPlan | null {
  const parsed = parseCommandArgs(text, specs, (name, committed) =>
    skipModelStep(context, name, committed),
  )
  // A trailing token that is not a chip yet (`… high` + Enter) counts as the active step's value.
  const committed = new Map(parsed.chips.map((chip) => [chip.spec.name, chip.option.value]))
  const tail = parsed.activeText.trim()
  if (parsed.activeSpec && tail && !/\s/.test(tail)) committed.set(parsed.activeSpec.name, tail)
  else if (tail) return null

  const target = commandTarget(context, committed.get('agent'))
  const connectionId = committed.get('provider')
  const model = connectionModel(context, connectionId, committed.get('model'))
  if (!target || !connectionId || !model) return null

  const chosen = committed.get('reasoning')
  let reasoningEffort = startReasoning(context, target, model)
  if (chosen !== undefined) {
    const offered = modelReasoningOptions(model.reasoningEfforts).some((o) => o.value === chosen)
    if (!isReasoningEffort(chosen) || !offered || !model.supportsReasoning) return null
    reasoningEffort = chosen
  }
  if (target.kind === 'party')
    return { kind: 'party', connectionId, modelId: model.id, reasoningEffort }

  const maxTurns = settingValue(committed.get('turns'), (raw) =>
    /^\d+$/.test(raw) ? clampMaxTurns(Number(raw)) : null,
  )
  const contextLimit = contextLimitValue(committed.get('context'), model.contextLength)
  // A limit this model does not offer is refused, as an unoffered reasoning level is.
  if (contextLimit === false) return null
  return {
    kind: 'agent',
    agentId: target.member.agentId,
    connectionId,
    modelId: model.id,
    providerId: model.providerId,
    reasoningEffort,
    settings: {
      ...(maxTurns !== undefined ? { maxTurns } : {}),
      ...(contextLimit !== undefined ? { contextLimit } : {}),
    },
  }
}
