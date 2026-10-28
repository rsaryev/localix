import type { ScriptSandbox, ScriptTool } from '@localixai/agent/runtime'

import { runAgentCall, type CallContext, type RunState } from './agent-call'
import { createReplay, type JournalEntry } from './journal'
import { loadsModules, WORKFLOW_HOST_TOOL, workflowSource, type WorkflowEvent } from './script'

/**
 * RUNS ONE WORKFLOW: its body in the script sandbox, each `agent()` through the host's port.
 *
 * Owns what Claude Code's workflow runtime owns and nothing about how an agent runs: the agent
 * count per run, structured output, one level of `workflow()`, the token budget, the journal a
 * resume replays (`journal.ts`), and the progress lines. The port decides where an agent runs (a
 * Localix child session, `chat/runtime/run/workflow-options.ts`): on which model and effort, in
 * which folder, and how many at once.
 */

/** Agents one run may start, nested workflows included, as in Claude Code. */
export const MAX_AGENTS_PER_RUN = 1000

export interface WorkflowAgentRequest {
  prompt: string
  /** What the agent is shown as: the script's `label`, else the prompt's start. */
  label: string
  phase?: string
  /** A custom agent to run as (`agentType`); the workflow's own agent when absent. */
  agentType?: string
  /** `worktree`: the agent works in a fresh git worktree of the chat's repository. */
  isolation?: 'worktree'
  /** 1-based, in the order the run started them. */
  ordinal: number
}

export interface WorkflowAgentOutcome {
  text: string | null
  /** Output tokens it spent, when the host can tell. */
  tokens?: number
  /** What it cost, in US dollars, when the host can tell. */
  costUsd?: number
  /** Lines for the run's progress: a model the host substituted, a worktree it kept. */
  notes?: string[]
}

export interface WorkflowHost {
  /** Run one agent to its end. Null when it was stopped or failed: `agent()` returns null. */
  runAgent(request: WorkflowAgentRequest, signal: AbortSignal): Promise<WorkflowAgentOutcome | null>
  /** A saved workflow `workflow()` names, or why there is none. */
  resolve(ref: unknown): Promise<{ name: string; body: string } | { error: string }>
  /** A progress line: `phase()`, `log()`, and the notes this runner adds. */
  onEvent?(event: WorkflowEvent, workflow: string): void
}

/** What a run spent and replayed, whichever way it ended. */
export interface WorkflowRunTally {
  agents: number
  /** Output tokens its agents spent. */
  spent: number
  costUsd: number
  /** Agents answered from the journal of the run it resumed. */
  cached: number
}

export type WorkflowRunResult =
  | ({ ok: true; value: unknown } & WorkflowRunTally)
  | ({ ok: false; error: string } & WorkflowRunTally)

export interface WorkflowRunInput {
  scripts: ScriptSandbox
  name: string
  body: string
  args: unknown
  host: WorkflowHost
  signal?: AbortSignal
  maxAgents?: number
  /** The token target (`budget.total`): agents are refused once it is spent. Null: none. */
  budget?: number | null
  /** The journal of the run this one resumes, and where this run's entries go. */
  journal?: { previous?: readonly JournalEntry[]; record?: (entry: JournalEntry) => void }
}

export async function runWorkflow(input: WorkflowRunInput): Promise<WorkflowRunResult> {
  const state: RunState = {
    agents: 0,
    spent: 0,
    costUsd: 0,
    cached: 0,
    replay: createReplay(input.journal?.previous),
    ...(input.journal?.record ? { record: input.journal.record } : {}),
  }
  return runIn(input, state, 0)
}

const tally = (state: RunState): WorkflowRunTally => ({
  agents: state.agents,
  spent: state.spent,
  costUsd: state.costUsd,
  cached: state.cached,
})

async function runIn(
  input: WorkflowRunInput,
  state: RunState,
  depth: number,
): Promise<WorkflowRunResult> {
  const { host, name } = input
  const maxAgents = input.maxAgents ?? MAX_AGENTS_PER_RUN
  const emit = (event: WorkflowEvent) => host.onEvent?.(event, name)
  const failed = (error: string): WorkflowRunResult => ({ ok: false, error, ...tally(state) })
  if (loadsModules(input.body))
    return failed('A workflow cannot load modules: it contains import()')
  const signal = input.signal ?? new AbortController().signal
  const budget = input.budget ?? null
  const call: CallContext = { state, host, maxAgents, budget, runSignal: signal, emit }

  const runNested = async (request: Record<string, unknown>) => {
    if (depth > 0) throw new Error('workflow() nests one level only')
    const found = await host.resolve(request.ref)
    if ('error' in found) throw new Error(found.error)
    const nested = await runIn(
      { ...input, name: found.name, body: found.body, args: request.args },
      state,
      depth + 1,
    )
    if (!nested.ok) throw new Error(`Workflow ${found.name} failed: ${nested.error}`)
    return { value: nested.value, spent: state.spent }
  }

  const hostTool: ScriptTool = {
    name: WORKFLOW_HOST_TOOL,
    description: 'The workflow host.',
    inputSchema: { type: 'object' },
    async execute(raw, callSignal) {
      const request = (raw ?? {}) as Record<string, unknown>
      for (const event of (request.events as WorkflowEvent[] | undefined) ?? []) emit(event)
      if (request.op === 'agent') return runAgentCall(call, request, callSignal)
      if (request.op === 'workflow') return runNested(request)
      throw new Error(`Unknown workflow call "${String(request.op)}"`)
    },
  }

  const run = await input.scripts.run({
    code: workflowSource(input.body, input.args, budget),
    tools: [hostTool],
    // A workflow runs as long as its agents do; stopping the call stops it.
    timeoutMs: Number.POSITIVE_INFINITY,
    signal,
  })
  if (!run.ok) return failed(run.error.stack ?? run.error.message)
  const { value, events } = (run.value ?? {}) as { value?: unknown; events?: WorkflowEvent[] }
  for (const event of events ?? []) emit(event)
  return { ok: true, value: value ?? null, ...tally(state) }
}
