import type { AgentToolResult, AsyncToolRegistry } from '@localixai/agent/agents'
import type { ScriptSandbox } from '@localixai/agent/runtime'
import { parseWorkflowMeta } from '@localixai/claude-plugin'

import { MAX_BACKGROUND_JOBS_PER_SESSION } from '../bash/bash-promote'
import type { JournalEntry, WorkflowRunStore } from './journal'
import { runWorkflow, type WorkflowAgentOutcome, type WorkflowAgentRequest } from './runner'
import type { WorkflowEvent } from './script'

/**
 * ONE RUN of the `workflow` tool: the script on its journal, its progress, its result — in the
 * background when the host can carry a job, as Claude Code runs a workflow while the session
 * stays free, and in the call otherwise.
 *
 * In the background the call returns at once with the run's id; the run is the chat's background
 * job (`jobs` lists and stops it), its progress lines update the call's card, and its end wakes the
 * chat with the result in a later turn, as a delegated task's report does.
 */

/** One workflow an enabled plugin ships. */
export interface WorkflowEntry {
  /** `<plugin>:<name>`, the command it runs as. */
  fullName: string
  description: string
  file: string
}

export interface WorkflowDetails {
  workflow: string
  runId?: string
  phase?: string
  agents: number
  lines: string[]
  background?: boolean
}

export interface WorkflowRunPort {
  scripts: ScriptSandbox
  read(file: string): Promise<string | null>
  /** Run one agent of run `runId` (started by `toolCallId`) as a child of this chat. */
  runAgent(
    toolCallId: string,
    workflow: string,
    request: WorkflowAgentRequest,
    signal: AbortSignal,
    runId: string,
  ): Promise<WorkflowAgentOutcome | null>
  /** This conversation's run journals; without it a run cannot be resumed. */
  runs?: WorkflowRunStore
}

/** Runs of this process that have not ended, by id: a resume waits until its run is over. */
const activeRuns = new Map<string, AbortController>()

export const isRunActive = (runId: string): boolean => activeRuns.has(runId)

/** What the result keeps of the return value; a larger one is cut, and says so. */
const MAX_RESULT_CHARS = 100_000
const MAX_LINES = 200

const render = (value: unknown) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}\n… (${text.length - MAX_RESULT_CHARS} more characters cut)`
    : text
}

export interface PreparedRun {
  toolCallId: string
  entry: WorkflowEntry
  body: string
  args: unknown
  runId: string
  budget: number | null
  previous: readonly JournalEntry[]
  entries: readonly WorkflowEntry[]
}

/** Run it to its end and say how it went; `onProgress` sees each new line. */
export async function executeRun(
  port: WorkflowRunPort,
  run: PreparedRun,
  signal: AbortSignal,
  onProgress: (details: WorkflowDetails) => void,
): Promise<AgentToolResult<WorkflowDetails>> {
  const { entry, runId } = run
  const details: WorkflowDetails = { workflow: entry.fullName, runId, agents: 0, lines: [] }
  const snapshot = () => onProgress({ ...details, lines: [...details.lines] })
  const note = (event: WorkflowEvent, workflow: string) => {
    const prefix = workflow === entry.fullName ? '' : `${workflow} › `
    if (event.type === 'phase') details.phase = event.title
    if (details.lines.length < MAX_LINES)
      details.lines.push(
        event.type === 'phase' ? `${prefix}## ${event.title}` : `${prefix}${event.message}`,
      )
    snapshot()
  }
  const controller = new AbortController()
  const stop = () => controller.abort()
  if (signal.aborted) stop()
  else signal.addEventListener('abort', stop, { once: true })
  activeRuns.set(runId, controller)
  try {
    const result = await runWorkflow({
      scripts: port.scripts,
      name: entry.fullName,
      body: run.body,
      args: run.args,
      signal: controller.signal,
      budget: run.budget,
      journal: {
        previous: run.previous,
        ...(port.runs ? { record: (journaled) => port.runs!.record(runId, journaled) } : {}),
      },
      host: {
        runAgent: (request, agentSignal) => {
          details.agents = request.ordinal
          snapshot()
          return port.runAgent(run.toolCallId, entry.fullName, request, agentSignal, runId)
        },
        resolve: async (ref) => {
          if (typeof ref !== 'string')
            return { error: 'workflow() takes a workflow name here; a scriptPath is not run' }
          const nested = findWorkflow(run.entries, ref)
          if (typeof nested === 'string') return { error: nested }
          const text = await port.read(nested.file)
          const meta = text === null ? null : parseWorkflowMeta(text)
          return meta?.meta
            ? { name: nested.fullName, body: meta.body }
            : { error: `Workflow ${nested.fullName} cannot be read` }
        },
        onEvent: note,
      },
    })
    await port.runs?.flush(runId)
    details.agents = result.agents
    const spent = [
      `${result.agents} agents`,
      ...(result.cached ? [`${result.cached} replayed from the resumed run`] : []),
      ...(result.spent ? [`${result.spent} output tokens`] : []),
      ...(result.costUsd ? [`$${result.costUsd.toFixed(4)}`] : []),
    ].join(', ')
    const where = port.runs
      ? `\nRun ${runId} (journal: ${port.runs.dirOf(runId)}). To resume it after a stop, run the workflow again with resumeFromRunId "${runId}".`
      : ''
    const progress = details.lines.length ? `\n\nProgress:\n${details.lines.join('\n')}` : ''
    if (!result.ok)
      return {
        content: `Workflow ${entry.fullName} ${controller.signal.aborted ? 'was stopped' : 'failed'} after ${spent}: ${result.error}${where}${progress}`,
        details,
        isError: true,
      }
    return {
      content: `Workflow ${entry.fullName} finished (${spent}).${where}${progress}\n\nResult:\n${render(result.value)}`,
      details,
    }
  } finally {
    signal.removeEventListener('abort', stop)
    activeRuns.delete(runId)
  }
}

/**
 * Start the run as the chat's background job and answer at once; null when the host carries no
 * job (or holds too many), and the caller runs it in the call.
 */
export function startInBackground(
  port: WorkflowRunPort,
  run: PreparedRun,
  registry: AsyncToolRegistry | undefined,
): AgentToolResult<WorkflowDetails> | null {
  if (!registry) return null
  // At the session's job limit the run waits in its call, as a promoted call does.
  if ((registry.countBackgroundJobs?.() ?? 0) >= MAX_BACKGROUND_JOBS_PER_SESSION) return null
  const { toolCallId, entry, runId } = run
  const controller = new AbortController()
  const dispose = registry.registerActions(
    toolCallId,
    { kill: { label: 'Stop', icon: 'square', tone: 'danger', execute: () => controller.abort() } },
    { label: `workflow ${entry.fullName} (${runId})`, notify: true },
  )
  const jobId = registry.getBackgroundJobId?.(toolCallId) ?? toolCallId
  void (async () => {
    try {
      const result = await executeRun(port, run, controller.signal, (details) =>
        registry.emitBackground(toolCallId, details.lines.join('\n'), {
          details: { ...details, background: true },
        }),
      )
      registry.emitBackground(toolCallId, String(result.content), {
        done: true,
        jobStatus: controller.signal.aborted ? 'killed' : result.isError ? 'failed' : 'completed',
        notify: true,
        ...(result.details ? { details: { ...result.details, background: true } } : {}),
      })
    } catch (error) {
      registry.emitBackground(
        toolCallId,
        `Workflow ${entry.fullName} failed: ${error instanceof Error ? error.message : String(error)}`,
        { done: true, jobStatus: 'failed', notify: true },
      )
    } finally {
      dispose()
    }
  })()
  return {
    content:
      `Workflow ${entry.fullName} is running in the background (run ${runId}, job_id: ${jobId}). ` +
      'Its agents run as child sessions of this chat; its result arrives in a later turn on its own, ' +
      `so do not wait or poll for it. \`jobs\` action="stop" job_id="${jobId}" stops it.`,
    details: { workflow: entry.fullName, runId, agents: 0, lines: [], background: true },
  }
}

/** A workflow by its full name, or by its bare name when only one plugin has it. */
export function findWorkflow(
  entries: readonly WorkflowEntry[],
  reference: string,
): WorkflowEntry | string {
  const wanted = reference.trim().replace(/^\//, '').toLowerCase()
  const exact = entries.find((entry) => entry.fullName.toLowerCase() === wanted)
  if (exact) return exact
  const bare = entries.filter((entry) => entry.fullName.toLowerCase().endsWith(`:${wanted}`))
  if (bare.length === 1) return bare[0]!
  const names = entries.map((entry) => entry.fullName).join(', ')
  return `No workflow "${reference}". ${names ? `Available: ${names}.` : 'No enabled plugin has workflows.'}`
}
