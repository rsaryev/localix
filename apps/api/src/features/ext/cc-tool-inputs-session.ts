/**
 * Localix's session tools in Claude Code's input shapes (the mod types' `BuiltinToolInputs`):
 * `loops` is `CronCreate` (`cron`, `prompt`, `recurring`), `CronDelete` (`id`), `CronList` or
 * `ScheduleWakeup` (`delaySeconds`, `prompt`) by its action; `McpResources` is
 * `ListMcpResourcesTool` (`server`) or `ReadMcpResourceTool` (`server`, `uri`).
 */
import { defined, num, without, type ToolShape } from './cc-tool-fields'

const LOOP_NAMES: Readonly<Record<string, string>> = {
  remove: 'CronDelete',
  list: 'CronList',
  reschedule: 'ScheduleWakeup',
}

// An update, a removal by another name or a run goes by the name the model calls it, `Loops`.
const loops: ToolShape = {
  name: 'Loops',
  names: ['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup'],
  nameFor(input) {
    if (input.action === 'add') return input.cron === undefined ? 'ScheduleWakeup' : 'CronCreate'
    return LOOP_NAMES[String(input.action)] ?? 'Loops'
  },
  toClaude(input) {
    const name = loops.nameFor!(input)
    if (name === 'CronCreate') return { ...input, recurring: true }
    if (name === 'ScheduleWakeup') return defined({ ...input, delaySeconds: input.delay_seconds })
    return input
  },
  fromClaude(fields, name) {
    const rest = without(fields, ['recurring', 'durable', 'delaySeconds', 'reason', 'stop', 'noop'])
    if (name === 'CronCreate') return { ...rest, action: rest.action ?? 'add' }
    if (name === 'CronDelete') return { ...rest, action: rest.action ?? 'remove' }
    if (name === 'CronList') return { ...rest, action: rest.action ?? 'list' }
    if (name !== 'ScheduleWakeup') return rest
    const delay = num(fields.delaySeconds) ?? num(rest.delay_seconds)
    // A wakeup with a prompt and no job is a new dynamic loop; otherwise the loop's next delay.
    const action = rest.action ?? (rest.id === undefined && rest.prompt ? 'add' : 'reschedule')
    return defined({ ...rest, action, delay_seconds: action === 'add' ? undefined : delay })
  },
}

const mcpResources: ToolShape = {
  name: 'ListMcpResourcesTool',
  names: ['ReadMcpResourceTool'],
  nameFor: (input) => (input.action === 'read' ? 'ReadMcpResourceTool' : 'ListMcpResourcesTool'),
  toClaude: (input) => input,
  fromClaude: (fields, name) =>
    fields.action !== undefined
      ? fields
      : { ...fields, action: name === 'ReadMcpResourceTool' ? 'read' : 'list' },
}

export const SESSION_SHAPES: Record<string, ToolShape> = {
  Loops: loops,
  McpResources: mcpResources,
}
