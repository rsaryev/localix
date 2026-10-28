/**
 * Localix's conversation tools in Claude Code's input shapes (hooks.md, PreToolUse input; the mod
 * types' `BuiltinToolInputs`): `Skill`'s `get` is Claude Code's `Skill` (`skill`, `args`), `AskUserQuestion` has
 * `header` and `multiSelect`, `Plan`'s `present` is `ExitPlanMode` (`plan`) and `ToolSearch` is
 * named as Claude Code names it, with no shape. `Agent`, `SendMessage` and `TaskStop` are
 * Claude Code's own, by name and fields, and need no shape.
 */
import { defined, isRecord, str, without, type Fields, type ToolShape } from './cc-tool-fields'

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

/** A presented plan as Claude Code's ExitPlanMode carries it: the Markdown, title first. */
export function planText(input: Fields): string | undefined {
  const body = str(input.body)
  const title = str(input.title)
  if (body === undefined) return title
  return title ? `# ${title}\n\n${body}` : body
}

// A call Claude Code has no tool for goes by the name the model calls it, `Plan`.
const plan: ToolShape = {
  name: 'Plan',
  names: ['ExitPlanMode'],
  nameFor: (input) => (input.action === 'present' ? 'ExitPlanMode' : 'Plan'),
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

/** `ToolSearch` takes Claude Code's `ToolSearch` fields as they are; only the name differs. */
const activateTools: ToolShape = {
  name: 'ToolSearch',
  toClaude: (input) => input,
  fromClaude: (fields) => fields,
}

/** `workflow` is Claude Code's `Workflow`, whose `name`, `args` and `resumeFromRunId` it shares. */
const workflow: ToolShape = {
  name: 'Workflow',
  toClaude: (input) => input,
  fromClaude: (fields) => fields,
}

export const AGENTIC_SHAPES: Record<string, ToolShape> = {
  Skill: skill,
  AskUserQuestion: ask,
  Plan: plan,
  ToolSearch: activateTools,
  Workflow: workflow,
}
