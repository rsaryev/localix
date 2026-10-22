import type { JournalEntry, WorkflowReplay } from './journal'
import type { WorkflowAgentOutcome, WorkflowAgentRequest, WorkflowHost } from './runner'
import type { WorkflowEvent } from './script'
import {
  parseStructured,
  schemaProblem,
  STRUCTURED_ATTEMPTS,
  structuredInstruction,
} from './structured'

/**
 * ONE `agent()` CALL of a workflow run: its options checked, its result replayed from the run
 * being resumed when the journal has it, otherwise its agent run through the host — again with
 * the reason while a `schema` reply does not fit — under the run's agent cap and token budget.
 */

/** What every call of one run shares, nested workflows included. */
export interface RunState {
  /** Agents started, replays included (Claude Code counts a cached replay against the cap). */
  agents: number
  /** Output tokens and cost the run's agents spent. */
  spent: number
  costUsd: number
  /** Calls answered from the journal of the run being resumed. */
  cached: number
  replay: WorkflowReplay
  record?: (entry: JournalEntry) => void
}

export interface CallContext {
  state: RunState
  host: WorkflowHost
  maxAgents: number
  /** The run's token target (`budget.total`), null without one. */
  budget: number | null
  /** The whole run's stop: an agent stopped with it is not a failure, and is not journaled. */
  runSignal: AbortSignal
  emit: (event: WorkflowEvent) => void
}

const labelOf = (prompt: string) => {
  const line = prompt.trim().split('\n')[0] ?? ''
  return line.length > 60 ? `${line.slice(0, 57)}…` : line
}

const optionString = (options: Record<string, unknown>, name: string): string | undefined => {
  const value = options[name]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`agent() option "${name}" takes a string`)
  return value.trim()
}

/** The request the host runs, from the script's prompt and options. */
function agentRequest(prompt: string, options: Record<string, unknown>) {
  const isolation = options.isolation
  if (isolation !== undefined && isolation !== 'worktree')
    throw new Error(`agent() option "isolation" takes 'worktree'; got ${JSON.stringify(isolation)}`)
  const model = optionString(options, 'model')
  const effort = optionString(options, 'effort')
  return {
    label: typeof options.label === 'string' ? options.label : labelOf(prompt),
    ...(typeof options.phase === 'string' ? { phase: options.phase } : {}),
    ...(typeof options.agentType === 'string' ? { agentType: options.agentType } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(isolation ? { isolation: 'worktree' as const } : {}),
  }
}

export async function runAgentCall(
  ctx: CallContext,
  raw: Record<string, unknown>,
  callSignal: AbortSignal,
): Promise<{ value: unknown; spent: number }> {
  const { state, host, maxAgents } = ctx
  const options = (raw.options ?? {}) as Record<string, unknown>
  const prompt = String(raw.prompt)
  const base = agentRequest(prompt, options)
  const schema = options.schema as Record<string, unknown> | undefined
  const problem = schema === undefined ? null : schemaProblem(schema)
  if (problem) throw new Error(`agent() schema: ${problem}`)
  // Claimed before anything awaits: the spawn order is the order the script made its calls.
  const claim = state.replay.claim({ prompt, options })
  if (claim.cached) {
    if (state.agents >= maxAgents)
      throw new Error(`A workflow run starts at most ${maxAgents} agents`)
    state.agents++
    state.cached++
    state.record?.({ ...claim.cached, index: claim.index })
    return { value: claim.cached.value ?? null, spent: state.spent }
  }
  const journal = (entry: Omit<JournalEntry, 'index' | 'key'>) => {
    // A stop of the whole run counts no agent as failed: it starts over on a resume.
    if (ctx.runSignal.aborted) return
    state.record?.({ index: claim.index, key: claim.key, ...entry })
  }
  let retry = ''
  let tokens = 0
  let costUsd = 0
  try {
    for (let attempt = 1; attempt <= (schema ? STRUCTURED_ATTEMPTS : 1); attempt++) {
      if (state.agents >= maxAgents)
        throw new Error(`A workflow run starts at most ${maxAgents} agents`)
      if (ctx.budget !== null && state.spent >= ctx.budget)
        throw new Error(
          `The workflow's token budget is spent: ${state.spent} of ${ctx.budget} output tokens`,
        )
      state.agents++
      const request: WorkflowAgentRequest = {
        ...base,
        prompt: [prompt, schema ? structuredInstruction(schema) : '', retry]
          .filter(Boolean)
          .join('\n\n'),
        ordinal: state.agents,
      }
      const outcome: WorkflowAgentOutcome | null = await host.runAgent(request, callSignal)
      tokens += outcome?.tokens ?? 0
      costUsd += outcome?.costUsd ?? 0
      state.spent += outcome?.tokens ?? 0
      state.costUsd += outcome?.costUsd ?? 0
      for (const message of outcome?.notes ?? []) ctx.emit({ type: 'log', message })
      if (!outcome || outcome.text === null) {
        journal({ status: 'failed', tokens, costUsd })
        return { value: null, spent: state.spent }
      }
      if (!schema) {
        journal({ status: 'completed', value: outcome.text, tokens, costUsd })
        return { value: outcome.text, spent: state.spent }
      }
      const parsed = parseStructured(outcome.text, schema)
      if ('value' in parsed) {
        journal({ status: 'completed', value: parsed.value, tokens, costUsd })
        return { value: parsed.value, spent: state.spent }
      }
      retry = `Your previous reply did not fit the schema: ${parsed.problem}. Reply again with only the JSON value.`
      if (attempt === STRUCTURED_ATTEMPTS)
        throw new Error(
          `The agent's reply did not fit its schema after ${STRUCTURED_ATTEMPTS} attempts: ${parsed.problem}`,
        )
    }
    return { value: null, spent: state.spent }
  } catch (error) {
    journal({ status: 'failed', tokens, costUsd })
    throw error
  }
}
