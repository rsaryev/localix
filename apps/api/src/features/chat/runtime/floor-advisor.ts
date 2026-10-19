/**
 * The `groupRouting` route made callable: the person's settings, the route's decision model, one
 * bounded call. Every miss — the route off, no connection serving its model, a slow or failed
 * call, an unconfident answer — is `null`, and the grammar decides as it always did.
 *
 * On by default (`model-task-catalog.ts`): with no model chosen the route runs the catalog's
 * default (`openrouter/~typesafe/jev-latest`) through ANY live connection of its provider, so
 * connecting OpenRouter turns it on and switching the route off in the model picker keeps it off.
 */
import { executeModelTask } from '../../model-task-runtime'
import { loadUserSettingsContext } from '../../user/runtime-settings'
import type { UserProfileRepository } from '../../user/repository'
import type { UsageRepository } from '../../usage/repository'
import {
  AUX_MODEL_TASKS,
  isModelRoutingTaskEnabled,
  type AuxModelTask,
} from '../model-task-catalog'
import type { RunnerDeps } from './agent-runner-types'
import {
  confidentFloor,
  floorDecisionRequest,
  type FloorAdvisor,
  type FloorScope,
} from './floor-advice'
import { resolveLanguageModel } from './model-resolution'
import { recordAuxCallUsage } from './usage-normalize'

const ROUTE = AUX_MODEL_TASKS.find(
  (task): task is Extract<AuxModelTask, { key: 'groupRouting' }> => task.key === 'groupRouting',
)!
/** Routing waits on this call before the next turn starts; past it the grammar answers. */
const FLOOR_DEADLINE_MS = 3_000
const FLOOR_TASK = { id: 'floor-advice', version: 1 } as const

export function createFloorAdvisor(deps: {
  runner: Pick<
    RunnerDeps,
    'providerConnectionsService' | 'catalogService' | 'languageModelFactory' | 'listRegistryAgents'
  >
  userProfileRepo: UserProfileRepository
  usageRepo: UsageRepository
  /** How long the next turn may wait on the advice; tests shorten it. */
  deadlineMs?: number
}) {
  const deadlineMs = deps.deadlineMs ?? FLOOR_DEADLINE_MS
  const advise = async (
    scope: FloorScope,
    asked: Parameters<FloorAdvisor>[0],
    deadlineAtMs: number,
  ): Promise<string | null> => {
    const { userId, sessionId } = scope
    if (!asked.text.trim() || asked.members.length < 2) return null
    const { agentSettings } = await loadUserSettingsContext(deps.userProfileRepo, userId)
    if (!isModelRoutingTaskEnabled(agentSettings, 'groupRouting')) return null
    const slot = agentSettings?.modelRouting?.groupRouting
    const modelId = slot?.modelId ?? ROUTE.defaultModelId
    // Decision models live in the full catalog only, and are looked up among their own kind: a
    // decision model may share its id with a chat model of the same provider (OpenAI's).
    const full = await deps.runner.catalogService.getFullCatalog()
    const resolved = await resolveLanguageModel({
      deps: deps.runner,
      userId,
      modelId,
      preferredConnectionId: slot?.providerConnectionId,
      catalog: { ...full, models: full.models.filter((model) => model.kind === 'decision') },
    })
    const decide = resolved?.model.decide?.bind(resolved.model)
    if (!resolved || !decide) return null
    // Each option is described the way the prompt's directory describes the agent.
    const directory = new Map(
      (await deps.runner.listRegistryAgents?.(userId, scope.projectId))?.map((agent) => [
        agent.agentId,
        agent.description,
      ]) ?? [],
    )
    const request = floorDecisionRequest({
      ...asked,
      members: asked.members.map((member) => ({
        ...member,
        description: member.description ?? directory.get(member.agentId),
      })),
    })
    const outcome = await executeModelTask({
      request: {
        task: FLOOR_TASK,
        system: '',
        input: request,
        // Bounded where it is assembled: FLOOR_WINDOW messages of FLOOR_MESSAGE_CHARS each.
        budget: { inputTokens: 4_096, outputTokens: 64 },
        capabilities: { structuredOutput: true, streaming: false },
        deadlineAtMs,
      },
      execute: async (task, signal) => {
        const result = await decide({ ...task.input, signal })
        return { output: result, usage: result.usage }
      },
    })
    if (outcome.status !== 'success') return null
    recordAuxCallUsage({
      usageRepo: deps.usageRepo,
      userId,
      sessionId,
      modelId,
      providerConnectionId: resolved.providerConnectionId,
      providerId: resolved.entry.id,
      kind: 'routing',
      usage: outcome.response.output.usage,
    })
    return confidentFloor(outcome.response.output, request)
  }
  // Advice only: a failure anywhere is the grammar's turn, never a failed routing. The deadline
  // covers the whole advice — settings, connection refresh, directory and call — because the
  // next turn waits on it.
  return (scope: FloorScope): FloorAdvisor =>
    (question) => {
      const deadlineAtMs = Date.now() + deadlineMs
      let timer: ReturnType<typeof setTimeout> | undefined
      const late = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), deadlineMs)
      })
      const advice = advise(scope, question, deadlineAtMs).catch((error: unknown) => {
        console.warn('[conversation] floor advice failed', error)
        return null
      })
      return Promise.race([advice, late]).finally(() => clearTimeout(timer))
    }
}
