import { availableParallelism } from 'node:os'

import { resolveDeclaredReasoningEffort } from '../../../../db/types'
import { envInt } from '../../../../lib/env'
import { bestModelForFamily, isModelAliasFamily } from '../../model-alias'
import type { WorkflowAgentRoute } from './agent-start'

/**
 * Where a workflow's agents run: on which model and effort (`agent()`'s `model` and `effort`), and
 * how many at once.
 *
 * MODEL. Claude Code picks a workflow agent's model as it picks a subagent's: the model the script
 * names comes first, else the session's. A family alias (`haiku`, `sonnet`, `opus`, `fable`)
 * resolves to the newest model of that family the chat's provider offers in the catalog, and the
 * child runs on the chat's connection; a concrete id is used when that provider offers it. A model
 * the provider does not offer is not guessed at: the agent runs on the chat's model and the run
 * says so, as Claude Code substitutes a model its allowlist blocks.
 *
 * EFFORT. Claude Code's `low` … `max` are Localix reasoning levels; the runtime clamps one the
 * model does not offer. An unknown word inherits the parent's level, and the run says so.
 */

export interface ChatModel {
  providerId: string
  connectionId: string
  modelId: string
}

export function workflowAgentRoute(input: {
  model?: string
  effort?: string
  chat: ChatModel
  catalog: readonly { id: string; providerId: string }[]
  /** Who asked, as the notes name it: a workflow's `agent()`, or a subagent type. */
  who?: string
}): { route: WorkflowAgentRoute; notes: string[] } {
  const notes: string[] = []
  const who = input.who ?? 'agent()'
  const route: WorkflowAgentRoute = {}
  if (input.effort) {
    const effort = resolveDeclaredReasoningEffort(input.effort.toLowerCase())
    if (effort) route.reasoningEffort = effort
    else notes.push(`${who} effort "${input.effort}" is not a reasoning level; the agent inherits`)
  }
  const wanted = input.model?.trim()
  if (wanted && wanted.toLowerCase() !== 'inherit') {
    // A catalog id may carry its provider (`openai/gpt-4o-mini`); a route names the model as the
    // provider does, the way the chat's own route does.
    const native = (id: string) => {
      const prefix = `${input.chat.providerId}/`
      return id.toLowerCase().startsWith(prefix.toLowerCase()) ? id.slice(prefix.length) : id
    }
    const offered = input.catalog
      .filter((model) => model.providerId === input.chat.providerId)
      .map((model) => native(model.id))
    const modelId = isModelAliasFamily(wanted)
      ? bestModelForFamily(
          wanted.toLowerCase() as Parameters<typeof bestModelForFamily>[0],
          offered,
        )
      : offered.find((id) => id.toLowerCase() === native(wanted).toLowerCase())
    if (modelId) {
      route.providerConnectionId = input.chat.connectionId
      route.modelId = modelId
    } else
      notes.push(
        `${who} model "${wanted}" is not offered by the chat's provider; the agent runs on ${input.chat.modelId}`,
      )
  }
  return { route, notes }
}

/** Claude Code's default and its ceiling for a workflow's concurrent agents. */
const DEFAULT_CONCURRENCY = 16
const MAX_CONCURRENCY = 256

/**
 * How many of one run's agents run at once: Claude Code's limit — up to 16, fewer on a machine
 * with fewer CPUs (two are left for everything else), and `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`
 * (1–256) when it is set. `LOCALIX_WORKFLOW_MAX_CONCURRENT_AGENTS` wins over both.
 */
export function workflowConcurrency(
  env: Record<string, string | undefined> = process.env,
  cpus = availableParallelism(),
): number {
  const set =
    envInt('LOCALIX_WORKFLOW_MAX_CONCURRENT_AGENTS', 0, env) ||
    envInt('CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS', 0, env)
  if (set > 0) return Math.min(MAX_CONCURRENCY, set)
  return Math.max(1, Math.min(DEFAULT_CONCURRENCY, cpus - 2))
}
