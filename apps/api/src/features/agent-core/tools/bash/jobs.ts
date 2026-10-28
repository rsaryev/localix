import { z } from 'zod'
import { truncateTail } from '@localixai/agent'
import { defineAgentTool, type CallClass } from '@localixai/agent/agents'
import { truncationMarker } from '../tool-output'
import { TOOL } from '../../tool-names'

export interface RunningJob {
  toolCallId: string
  jobId?: string
  command: string
  startedAt: number
  /** The PTY it runs in — what `bash` `terminal_id` takes to read or type into it. */
  terminalId?: string
}

/** A background job's current output (for `action="read"`). */
export interface JobOutput {
  output: string
  running: boolean
}

export interface JobsToolDeps {
  /** Snapshot of background jobs still running in this session. */
  listJobs: () => RunningJob[]
  /** Resolve a model-facing short job id to the underlying tool call id. */
  resolveJobId?: (jobId: string) => string | null
  /** Run a registered action (kill / send_input) on a job; false if not found. */
  runAction: (toolCallId: string, action: 'kill' | 'send_input', payload?: unknown) => boolean
  /** Current output of a job by id (PTY scrollback). Null when not readable / exited. */
  readJob?: (toolCallId: string) => JobOutput | null
  now: () => number
}

/** Tail returned for `read` — recent output is what matters for "is it erroring?". */
const MAX_READ_CHARS = 20_000

const inputSchema = z.object({
  action: z.enum(['list', 'read', 'send_input']),
  job_id: z.string().optional().describe('From list or a reminder. Required except for list.'),
  input: z.string().optional().describe('send_input: text for the stdin of a bash job.'),
})

const JOBS_READ: CallClass = { effect: 'read' }
const JOBS_SEND: CallClass = { effect: 'external' }

/** One `jobs` call's class; an action this table does not name is `external` (fail-closed). */
export function classifyJobsCall(input: unknown): CallClass {
  const action = ((input ?? {}) as { action?: unknown }).action
  if (action === 'list' || action === 'read') return JOBS_READ
  return JOBS_SEND
}

/**
 * Lets the model see and manage its own long-running background jobs (dev
 * servers, watchers, and live data streams) across turns. Background jobs keep
 * running after the turn that started them; without this the model is blind to
 * them and tends to spawn duplicates or poll with sleep loops. send_input, and `TaskStop`'s stop
 * (`stopJob`), reuse the exact same action registry the UI Stop button drives.
 */
export function createJobsTool(deps: JobsToolDeps, options: { terminalInput?: boolean } = {}) {
  return defineAgentTool({
    name: TOOL.Jobs,
    label: 'Jobs',
    activeVerb: 'Managing jobs',
    // The wait rule (`bash until`, never a poll loop) lives on bash's `until` field only.
    description: [
      'See background work: list before launching duplicates; read returns logs/events; send_input writes raw stdin. TaskStop stops a job.',
      ...(options.terminalInput
        ? [
            'Interactive PTYs: bash type/keys with terminal_id sends named keys AND returns the current screen. read is accumulated logs.',
          ]
        : []),
    ].join(' '),
    inputSchema,
    // `send_input` writes to a live process's stdin — processes are external state by the same
    // measure as files. `list`/`read` only observe, and they are the half a read-only
    // investigation wants, so a plan session must not lose them to the static flag.
    mutates: true,
    classify: classifyJobsCall,
    executionMode: 'sequential',
    // list/read only observe, so they overlap other reads; send_input stays a barrier.
    executionModeFor: (input) =>
      classifyJobsCall(input).effect === 'read' ? 'parallel' : 'sequential',
    async execute(_toolCallId, input) {
      const jobs = deps.listJobs()
      if (input.action === 'list') {
        if (jobs.length === 0) return { content: 'No background jobs are running.' }
        const lines = jobs.map(
          (j) =>
            `- ${j.jobId ?? j.toolCallId}: \`${j.command}\` (running ${Math.round((deps.now() - j.startedAt) / 1000)}s${j.terminalId ? `, terminal ${j.terminalId}` : ''})`,
        )
        return { content: `Running background jobs:\n${lines.join('\n')}` }
      }

      if (!input.job_id) {
        return {
          content: `job_id is required for action="${input.action}". Call action="list" first.`,
          isError: true,
        }
      }

      // Every id is resolved AGAINST THIS SESSION'S OWN JOBS, and an id that resolves to
      // nothing is refused here rather than handed on. This used to end in
      // `?? input.job_id` — a raw, unvalidated fallback — while the ownership check below
      // sat AFTER the `read` branch, so `read` was the one action that accepted a
      // foreign id and the host then looked it up in the PROCESS-WIDE job map: another
      // session's live PTY scrollback, readable by any sub-agent or delegated task run.
      // `resolveJobId` returning null for a non-owned id is deliberate (async-registry),
      // so falling back past it defeated the guard on purpose-built refusal.
      // Both spellings a model can legitimately hold are still accepted — the short
      // `jobId` we hand it, and the internal `toolCallId` — but only when they belong to
      // a job in `listJobs()`, which is session-filtered.
      const toolCallId =
        deps.resolveJobId?.(input.job_id) ??
        jobs.find((j) => j.jobId === input.job_id || j.toolCallId === input.job_id)?.toolCallId

      if (!toolCallId) {
        return {
          content: `No running job with id ${input.job_id}. Call action="list" to see current jobs.`,
          isError: true,
        }
      }
      const terminalId = jobs.find((job) => job.toolCallId === toolCallId)?.terminalId
      const screenAdvice =
        options.terminalInput && terminalId
          ? ` For the current TUI screen, use \`Bash\` action="screen", terminal_id="${terminalId}"; type with keys:["Enter"] submits text and returns the screen.`
          : ''

      // read works while the job is live (its terminal scrollback); a just-exited
      // job returns null → the final output was already delivered when it finished.
      if (input.action === 'read') {
        const snap = deps.readJob?.(toolCallId) ?? null
        if (!snap) {
          return {
            content: `No readable output for job ${input.job_id} — it may not run in a terminal, or has already exited (its final output was returned when it finished).`,
            isError: true,
          }
        }
        // Honest, like every other model-facing cap: a bare leading `…` gave the model no idea how much
        // of the job's output it was NOT seeing, on the one call whose entire purpose is inspecting that
        // output. `ToolOutput` already does this right ("clipped at N chars"); this did not.
        const clipped =
          snap.output.length > MAX_READ_CHARS
            ? truncateTail(snap.output, { maxBytes: MAX_READ_CHARS })
            : null
        const tail = clipped
          ? `${truncationMarker(clipped, {
              kept: 'last',
              advice: 'Re-read after it settles, or have the job write to a file and read that.',
            })}\n${clipped.content}`
          : snap.output
        return {
          content: `[job ${input.job_id} — ${snap.running ? 'running' : 'exited'}]${screenAdvice}\n${tail.trim() || '(no output yet)'}`,
          supersedeKey: `job:${toolCallId}`,
        }
      }

      // send_input
      if (!input.input) {
        return { content: 'input text is required for action="send_input".', isError: true }
      }
      // Same honesty: delivery is not observable from here. The write is attempted, and a
      // job that already exited discards it — a closed pipe is swallowed at the process edge.
      const ok = deps.runAction(toolCallId, 'send_input', { text: input.input })
      return {
        content: ok
          ? `Input sent to job ${input.job_id}. Delivery is not confirmed — a job that already exited discards it; ${screenAdvice ? screenAdvice.trim() : 'check its output with action="read".'}`
          : `Could not send input to job ${input.job_id} — it accepts no input (it may have already finished).`,
        isError: !ok,
      }
    },
  })
}

/**
 * Ask a job to stop. "Stopped" was a claim nothing here can make. Running the action invokes a
 * `void` closure; for a process that means SIGTERM with SIGKILL held back for a grace window, so
 * the job is usually still alive when this returns — and for an already-settled job the closure
 * does nothing at all. A model told "stopped" stops polling and reasons as though the work is gone.
 */
function requestStop(deps: JobsToolDeps, toolCallId: string, jobId: string) {
  const ok = deps.runAction(toolCallId, 'kill')
  return {
    content: ok
      ? `Stop requested for job ${jobId}. It is not confirmed gone: a process is given a moment to exit before it is killed.`
      : `Could not request a stop for job ${jobId} — it has no stop action (it may have already finished).`,
    isError: !ok,
  }
}

/**
 * `TaskStop` on a background job: the same stop, for an id that names one of THIS session's jobs
 * (`listJobs` is session-filtered), else `undefined` so the caller can try its subagents.
 */
export function stopJob(deps: JobsToolDeps, jobId: string) {
  const toolCallId =
    deps.resolveJobId?.(jobId) ??
    deps.listJobs().find((job) => job.jobId === jobId || job.toolCallId === jobId)?.toolCallId
  return toolCallId ? requestStop(deps, toolCallId, jobId) : undefined
}
