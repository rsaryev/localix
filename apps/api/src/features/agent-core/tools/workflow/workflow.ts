import { z } from 'zod'
import { defineAgentTool, type CallClass } from '@localixai/agent/agents'
import { parseWorkflowMeta } from '@localixai/claude-plugin'

import { TOOL } from '../../tool-names'
import { newRunId, type JournalEntry } from './journal'
import {
  executeRun,
  findWorkflow,
  isRunActive,
  startInBackground,
  type WorkflowDetails,
  type WorkflowEntry,
  type WorkflowRunPort,
} from './workflow-run'

export { findWorkflow, type WorkflowDetails, type WorkflowEntry } from './workflow-run'

/**
 * `workflow` — run a Claude Code plugin workflow (`workflows/*.js`), the script that orchestrates
 * many agents (`runner.ts`). A plugin's `/<plugin>:<name>` command asks for it; the model passes
 * the person's input as `args`, structured when it is a list or an object, as Claude Code does.
 * Each agent is a child session of this chat; only the script's return value comes back here.
 *
 * As in Claude Code, the run goes on in the background (`workflow-run.ts`) and reports when it
 * ends; it has an id, and a run that was stopped — by the person, or a restart — is resumed by
 * running the workflow again with `resumeFromRunId`: completed agents return their saved results.
 */

export interface WorkflowToolPort extends WorkflowRunPort {
  /** The enabled plugins' workflows, read when called. */
  list(): Promise<WorkflowEntry[]>
}

/** It starts child sessions, which this conversation owns. */
const WORKFLOW_CLASS: CallClass = { effect: 'session' }

const inputSchema = z.object({
  name: z.string().trim().min(1).describe('The workflow: `<plugin>:<name>`.'),
  args: z
    .unknown()
    .optional()
    .describe('Its input, as JSON: a list or an object when the input is structured.'),
  resumeFromRunId: z
    .string()
    .trim()
    .optional()
    .describe(
      'Resume an earlier run of this conversation that stopped (its run id, `wf-…`): completed agents return their saved results. Omit args to reuse that run’s.',
    ),
  budget: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'A token target for the run (the script’s budget.total), only when the person set one, such as "+500k" (500000).',
    ),
})

type Input = z.infer<typeof inputSchema>

export function createWorkflowTool(port: WorkflowToolPort) {
  return defineAgentTool<Input, WorkflowDetails>({
    name: TOOL.workflow,
    label: 'Workflow',
    activeVerb: 'Running a workflow',
    description:
      "Run a plugin workflow: a script that runs many agents in child sessions and returns one result. Use it when the person runs a workflow's /<plugin>:<name> command; pass their input as args. It runs in the background and its result arrives in a later turn; resumeFromRunId resumes a stopped run.",
    inputSchema,
    mutates: true,
    classify: () => WORKFLOW_CLASS,
    executionMode: 'sequential',
    async execute(toolCallId, input, signal, onUpdate, context) {
      const entries = await port.list()
      const found = findWorkflow(entries, input.name)
      if (typeof found === 'string') return { content: found, isError: true }
      const source = await port.read(found.file)
      const parsed = source === null ? null : parseWorkflowMeta(source)
      if (!parsed?.meta) {
        const why = parsed && 'error' in parsed ? parsed.error : 'it cannot be read'
        return { content: `Workflow ${found.fullName} cannot run: ${why}`, isError: true }
      }
      const resumed = await resumeOf(port, input)
      if (typeof resumed === 'string') return { content: resumed, isError: true }
      const runId = newRunId()
      const args = input.args === undefined ? resumed?.args : input.args
      await port.runs
        ?.begin(
          {
            runId,
            workflow: found.fullName,
            ...(args === undefined ? {} : { args }),
            ...(input.resumeFromRunId ? { resumedFrom: input.resumeFromRunId } : {}),
          },
          source!,
        )
        .catch((error: unknown) => console.warn(`[workflow] run ${runId} not journaled:`, error))
      const run = {
        toolCallId,
        entry: found,
        body: parsed.body,
        args,
        runId,
        budget: input.budget ?? null,
        previous: resumed?.entries ?? [],
        entries,
      }
      return (
        startInBackground(port, run, context?.asyncRegistry) ??
        executeRun(port, run, signal ?? new AbortController().signal, (details) =>
          onUpdate?.(details),
        )
      )
    },
  })
}

/** The run `resumeFromRunId` names, or why it cannot be resumed; undefined for a new run. */
async function resumeOf(
  port: WorkflowToolPort,
  input: Input,
): Promise<{ args: unknown; entries: JournalEntry[] } | string | undefined> {
  const from = input.resumeFromRunId
  if (!from) return undefined
  if (!port.runs) return 'This chat keeps no workflow journals, so a run cannot be resumed.'
  if (isRunActive(from))
    return `Workflow run ${from} is still running. Stop it first (\`jobs\` action="stop"); a resume waits until its agents have ended.`
  const loaded = await port.runs.load(from)
  if (!loaded)
    return `Nothing to resume: this conversation has no workflow run ${from}. Start the workflow over without resumeFromRunId.`
  return { args: loaded.meta.args, entries: loaded.entries }
}
