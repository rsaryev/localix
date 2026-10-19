/**
 * WHO SPEAKS NEXT, ASKED OF THE FIRST STRATEGY THAT CAN ANSWER — a chain of responsibility.
 *
 * The strategies, in order (`agent-runner.ts`): a decision model through OpenRouter (Jev) where a
 * connection serves it (`floor-decision.ts`); else the embedding model by similarity, for the
 * person's untagged messages (`floor-similarity.ts`); else none, and the address grammar decides.
 * Nothing is configured: availability chooses. A strategy that answers and then fails, is late or
 * is unsure also leaves the turn to the grammar — silently for the person; each decision writes
 * one record to the API log, without message text.
 */
import type { RunnerDeps } from './agent-runner-types'
import type { FloorAdvisor, FloorQuestion, FloorReading, FloorScope } from './floor-advice'

/** Routing waits on the advice before the next turn starts; past this the grammar answers. */
const FLOOR_DEADLINE_MS = 3_000

/** One prepared way to answer, for one scope. */
export interface FloorRunner {
  /** Which strategy and model answer: what the decision's log record names. */
  readonly strategy: 'decision' | 'similarity'
  readonly model: string
  advise(question: FloorQuestion, signal: AbortSignal): Promise<FloorReading>
}

/** A link of the chain: a runner when it can answer for `scope` right now, else null. */
export interface FloorStrategy {
  prepare(scope: FloorScope): Promise<FloorRunner | null>
}

type Missed = { pick: null; reason: 'none' | 'deadline' | 'error' }

export type FloorDecisionRecord = {
  sessionId: string
  /** `message` for the person's words, `reply` for a participant's. */
  on: 'message' | 'reply'
  author?: string
  /** The strategy that answered; null when none could. */
  strategy: FloorRunner['strategy'] | null
  model?: string
  ms: number
} & (FloorReading | Missed)

export function createFloorAdvisor(deps: {
  strategies: readonly FloorStrategy[]
  listRegistryAgents?: RunnerDeps['listRegistryAgents']
  /** How long the next turn may wait on the advice; tests shorten it. */
  deadlineMs?: number
  log?: (record: FloorDecisionRecord) => void
}) {
  const deadlineMs = deps.deadlineMs ?? FLOOR_DEADLINE_MS

  /** The first strategy that can answer; null leaves the turn to the grammar. */
  async function firstRunner(scope: FloorScope): Promise<FloorRunner | null> {
    for (const strategy of deps.strategies) {
      const runner = await strategy.prepare(scope).catch(() => null)
      if (runner) return runner
    }
    return null
  }

  /** Each option described the way the prompt's directory describes the agent. */
  async function described(scope: FloorScope, question: FloorQuestion): Promise<FloorQuestion> {
    const directory = new Map(
      (await deps.listRegistryAgents?.(scope.userId, scope.projectId))?.map((agent) => [
        agent.agentId,
        agent.description,
      ]) ?? [],
    )
    return {
      ...question,
      members: question.members.map((member) => ({
        ...member,
        description: member.description ?? directory.get(member.agentId),
      })),
    }
  }

  return (scope: FloorScope): FloorAdvisor =>
    async (question) => {
      if (!question.text.trim() || question.members.length < 2) return null
      const startedAt = Date.now()
      let runner: FloorRunner | null = null
      const record = (outcome: FloorReading | Missed) =>
        deps.log?.({
          sessionId: scope.sessionId,
          on: question.authorAgentId ? 'reply' : 'message',
          ...(question.authorAgentId
            ? { author: question.members.find((m) => m.agentId === question.authorAgentId)?.handle }
            : {}),
          strategy: runner?.strategy ?? null,
          ...(runner ? { model: runner.model } : {}),
          ms: Date.now() - startedAt,
          ...outcome,
        })

      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      const late = new Promise<'late'>((resolve) => {
        timer = setTimeout(() => resolve('late'), deadlineMs)
      })
      const advice = (async (): Promise<FloorReading | null> => {
        runner = await firstRunner(scope)
        return runner ? runner.advise(await described(scope, question), controller.signal) : null
      })()
      advice.catch(() => {})

      // Advice only: a failure anywhere is the grammar's turn, never a failed routing. The deadline
      // covers the whole advice — connection, directory and call — because the next turn waits.
      try {
        const reading = await Promise.race([advice, late])
        if (reading === 'late') {
          controller.abort()
          record({ pick: null, reason: 'deadline' })
          return null
        }
        record(reading ?? { pick: null, reason: 'none' })
        return reading?.pick ?? null
      } catch (error) {
        console.warn('[conversation] floor advice failed', error)
        record({ pick: null, reason: 'error' })
        return null
      } finally {
        clearTimeout(timer)
      }
    }
}
