/**
 * Localix's conversation tools in Claude Code's input shapes (hooks.md, PreToolUse input; the mod
 * types' `BuiltinToolInputs`): `delegate` is `Agent` (`prompt`, `description`, `subagent_type`),
 * `SendMessage` (`to`, `message`) or `TaskStop` (`task_id`) by its action, `skill`'s `get` is
 * `Skill` (`skill`, `args`), `ask` is `AskUserQuestion` (`header`, `multiSelect`), `jobs`'
 * `stop` is `TaskStop`, `plan`'s `present` is `ExitPlanMode` (`plan`) and `activate_tools` is
 * `ToolSearch` (`select:<names>`).
 */
import { defined, isRecord, str, without, type Fields, type ToolShape } from './cc-tool-fields'

const AGENT_KEYS = ['description', 'prompt', 'subagent_type', 'model', 'effort', 'name']
const AGENT_MORE = ['team_name', 'mode', 'isolation', 'run_in_background', 'to', 'summary']
const STOP_KEYS = ['task_id', 'shell_id', 'notify_when_idle']

/** The first child a `run` names (`stop` and `close` take a list). */
const firstRun = (run: unknown) => (Array.isArray(run) ? run[0] : run)

const delegate: ToolShape = {
  name: 'Agent',
  names: ['SendMessage', 'TaskStop', 'Task'],
  nameFor: (input) =>
    input.action === 'message'
      ? 'SendMessage'
      : input.action === 'stop' || input.action === 'close'
        ? 'TaskStop'
        : 'Agent',
  toClaude(input) {
    const name = delegate.nameFor!(input)
    if (name === 'SendMessage') return defined({ ...input, to: firstRun(input.run) })
    if (name === 'TaskStop') return defined({ ...input, task_id: firstRun(input.run) })
    if (input.action !== undefined) return input
    return defined({
      ...input,
      description: input.title,
      prompt: input.task,
      subagent_type: input.agent,
    })
  },
  fromClaude(fields, name) {
    const rest = without(fields, [...AGENT_KEYS, ...AGENT_MORE, ...STOP_KEYS])
    if (name === 'SendMessage')
      return defined({ ...rest, action: 'message', run: fields.to ?? rest.run })
    if (name === 'TaskStop')
      return defined({
        ...rest,
        action: rest.action ?? 'stop',
        run: fields.task_id ?? fields.shell_id ?? rest.run,
      })
    if (rest.action !== undefined) return rest
    return defined({
      ...rest,
      task: fields.prompt ?? rest.task,
      title: fields.description ?? rest.title,
      agent: fields.subagent_type ?? rest.agent,
    })
  },
}

const skill: ToolShape = {
  name: 'Skill',
  toClaude: (input) =>
    input.action === 'get'
      ? defined({ ...input, skill: input.name, args: input.arguments })
      : input,
  fromClaude(fields) {
    const rest = without(fields, ['skill', 'args'])
    if (typeof fields.skill !== 'string') return rest
    return defined({
      ...rest,
      action: rest.action ?? 'get',
      name: fields.skill,
      arguments: fields.args ?? rest.arguments,
    })
  },
}

const QUESTION_KEYS = ['header', 'multiSelect', 'kind', 'placeholder', 'min', 'max', 'step']

const ask: ToolShape = {
  name: 'AskUserQuestion',
  toClaude(input) {
    if (!Array.isArray(input.questions)) return input
    const questions = input.questions.map((q) =>
      isRecord(q) ? { ...q, header: q.header ?? q.id, multiSelect: q.multi === true } : q,
    )
    return { ...input, questions }
  },
  fromClaude(fields) {
    // `answers` stays: the ask tool answers a call that carries a hook's answers itself.
    const rest = without(fields, ['annotations', 'metadata'])
    if (!Array.isArray(rest.questions)) return rest
    const questions = rest.questions.map((q, i) => {
      if (!isRecord(q)) return q
      const multi = typeof q.multiSelect === 'boolean' ? q.multiSelect : q.multi
      const options = Array.isArray(q.options)
        ? q.options.map((o) => (isRecord(o) ? without(o, ['preview']) : o))
        : q.options
      return defined({
        ...without(q, [...QUESTION_KEYS, 'defaultValue', 'unit', 'description']),
        id: q.id ?? str(q.header) ?? `q${i + 1}`,
        options,
        multi: multi === true ? true : undefined,
      })
    })
    return { ...rest, questions }
  },
}

const jobs: ToolShape = {
  name: 'jobs',
  names: ['TaskStop'],
  nameFor: (input) => (input.action === 'stop' ? 'TaskStop' : 'jobs'),
  toClaude: (input) =>
    input.action === 'stop' ? defined({ ...input, task_id: input.job_id }) : input,
  fromClaude(fields, name) {
    const rest = without(fields, STOP_KEYS)
    if (name !== 'TaskStop') return rest
    return defined({
      ...rest,
      action: rest.action ?? 'stop',
      job_id: fields.task_id ?? fields.shell_id ?? rest.job_id,
    })
  },
}

/** A presented plan as Claude Code's ExitPlanMode carries it: the Markdown, title first. */
export function planText(input: Fields): string | undefined {
  const body = str(input.body)
  const title = str(input.title)
  if (body === undefined) return title
  return title ? `# ${title}\n\n${body}` : body
}

const plan: ToolShape = {
  name: 'plan',
  names: ['ExitPlanMode'],
  nameFor: (input) => (input.action === 'present' ? 'ExitPlanMode' : 'plan'),
  toClaude: (input) =>
    input.action === 'present' ? defined({ ...input, plan: planText(input) }) : input,
  // ExitPlanMode's plan is "injected from the plan file": a hook's copy of it changes nothing.
  fromClaude: (fields, name) =>
    without(name === 'ExitPlanMode' ? { action: 'present', ...fields } : fields, [
      'plan',
      'planFilePath',
      'allowedPrompts',
    ]),
}

const activateTools: ToolShape = {
  name: 'ToolSearch',
  toClaude: (input) =>
    Array.isArray(input.names)
      ? { ...input, query: `select:${input.names.join(',')}`, max_results: input.names.length }
      : input,
  fromClaude(fields) {
    const rest = without(fields, ['query', 'max_results'])
    const query = str(fields.query)
    if (!query?.startsWith('select:')) return rest
    const names = query
      .slice('select:'.length)
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
    return names.length > 0 ? { ...rest, names } : rest
  },
}

// `jobs` before `delegate`: Claude Code's TaskStop named alone is a background command's.
export const AGENTIC_SHAPES: Record<string, ToolShape> = {
  jobs,
  delegate,
  skill,
  ask,
  plan,
  activate_tools: activateTools,
}
