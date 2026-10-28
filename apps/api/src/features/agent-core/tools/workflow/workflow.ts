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
  script: z
    .string()
    .optional()
    .describe(
      'An inline workflow script: plain JavaScript (not TypeScript) that begins with `export const meta = { name, description, phases? }` as a pure literal, then the body; `return` its result. See the tool description for the API.',
    ),
  name: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'The name of a workflow saved in `.claude/workflows/` or `~/.claude/workflows/`, or a plugin workflow (`<plugin>:<name>`). Resolved to a script.',
    ),
  scriptPath: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'The path of a workflow script file on disk, such as the scriptPath a previous run returned. Takes precedence over script and name.',
    ),
  args: z
    .unknown()
    .optional()
    .describe(
      'The input exposed to the script as the global `args`: any JSON value, passed as an actual array or object, not as a JSON-encoded string.',
    ),
  resumeFromRunId: z
    .string()
    .trim()
    .optional()
    .describe(
      'The run id of an earlier Workflow call of this conversation to resume. Completed agent() calls with unchanged inputs return cached results; the rest run live.',
    ),
  title: z.string().optional().describe('Ignored: the script’s meta block sets the title.'),
  description: z
    .string()
    .optional()
    .describe('Ignored: the script’s meta block sets the description.'),
})

type Input = z.infer<typeof inputSchema>

/** The script a call runs, its entry, or why it cannot run. */
async function resolveScript(
  port: WorkflowToolPort,
  input: Input,
  entries: WorkflowEntry[],
): Promise<{ entry: WorkflowEntry; source: string; body: string } | string> {
  let entry: WorkflowEntry | undefined
  let source: string | null
  if (input.scriptPath) {
    source = await port.read(input.scriptPath)
    if (source === null) return `Workflow script ${input.scriptPath} cannot be read.`
    entry = { fullName: '', description: '', file: input.scriptPath }
  } else if (input.script !== undefined) {
    source = input.script
    entry = { fullName: '', description: '', file: '' }
  } else if (input.name) {
    const found = findWorkflow(entries, input.name)
    if (typeof found === 'string') return found
    entry = found
    source = await port.read(found.file)
  } else {
    return 'At least one of script, name or scriptPath is required.'
  }
  const parsed = source === null ? null : parseWorkflowMeta(source)
  if (!parsed?.meta) {
    const why = parsed && 'error' in parsed ? parsed.error : 'it cannot be read'
    return `Workflow ${entry.fullName || input.name || 'script'} cannot run: ${why}`
  }
  const named = entry.fullName
    ? entry
    : { ...entry, fullName: parsed.meta.name, description: parsed.meta.description }
  return { entry: named, source: source!, body: parsed.body }
}

export function createWorkflowTool(port: WorkflowToolPort) {
  return defineAgentTool<Input, WorkflowDetails>({
    name: TOOL.Workflow,
    label: 'Workflow',
    activeVerb: 'Running a workflow',
    description: [
      'Run a dynamic workflow: a script that orchestrates many subagents in the background and returns one consolidated result. It returns at once and the result arrives in a later turn; resumeFromRunId resumes an earlier run of this conversation.',
      'Use it only when the person asked for a workflow or multi-agent orchestration in their own words, when a command or skill they invoked says to run one, or when they named a saved or plugin workflow (`name`, or `scriptPath` of a script a run returned). Otherwise describe what a workflow would do and ask.',
      'Script: plain JavaScript that begins with `export const meta = { name, description, phases? }` as a pure literal. No Date.now(), Math.random() or argless new Date() (pass a seed or time in through args). Its `return` value is the result. Globals:',
      '- agent(prompt, { label, phase, schema, agentType, isolation: "worktree" }): runs one subagent; resolves to its final text, to the validated object when `schema` (JSON Schema) is given, or to null if the agent dies.',
      '- parallel(thunks): takes FUNCTIONS, `() => agent(...)`, never promises. A barrier: waits for all, results in order; a thunk that throws gives null and the call never rejects.',
      '- pipeline(items, ...stages): each stage is `(prev, item, index) => ...`; every item flows through the stages on its own, with no barrier between them, and a stage that throws drops that item to null. The default for multi-stage work.',
      '- phase(title) groups the agents that follow; log(message) adds a progress line; args is the input; budget.total / spent() / remaining() track output tokens; workflow(name, args) runs a nested workflow.',
      'Example:',
      '```js',
      "export const meta = { name: 'audit', description: 'Review each file, then merge', phases: [{ title: 'Review' }, { title: 'Merge' }] }",
      "const reviews = await pipeline(args.files, (file) => agent(`Review ${file}`, { label: file, phase: 'Review' }))",
      "const [summary] = await parallel([() => agent(`Merge these reviews: ${reviews.filter(Boolean).join('\\n')}`, { phase: 'Merge' })])",
      'return { summary }',
      '```',
    ].join('\n'),
    inputSchema,
    mutates: true,
    classify: () => WORKFLOW_CLASS,
    executionMode: 'sequential',
    async execute(toolCallId, input, signal, onUpdate, context) {
      const entries = await port.list()
      const script = await resolveScript(port, input, entries)
      if (typeof script === 'string') return { content: script, isError: true }
      const { entry: found, source, body } = script
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
          source,
        )
        .catch((error: unknown) => console.warn(`[workflow] run ${runId} not journaled:`, error))
      const run = {
        toolCallId,
        entry: found,
        body,
        args,
        runId,
        budget: null,
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
    return `Workflow run ${from} is still running. Stop it first (TaskStop); a resume waits until its agents have ended.`
  const loaded = await port.runs.load(from)
  if (!loaded)
    return `Nothing to resume: this conversation has no workflow run ${from}. Start the workflow over without resumeFromRunId.`
  return { args: loaded.meta.args, entries: loaded.entries }
}
