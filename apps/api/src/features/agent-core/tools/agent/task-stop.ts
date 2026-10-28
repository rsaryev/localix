import { z } from 'zod'
import { defineAgentTool, type CallClass } from '@localixai/agent/agents'

import { TOOL } from '../../tool-names'
import {
  findChild,
  listChildren,
  stopChild,
  type AgentControlPorts,
  type ToolAnswer,
} from './agent-control'

/**
 * `TaskStop` — Claude Code's one way to stop something running in the background: a subagent this
 * conversation started (by its id or name) or a background shell job (by its job id).
 */
export interface TaskStopPorts {
  children?: AgentControlPorts
  /** Stop a background job of this session; `undefined` when the id names none of its jobs. */
  stopJob?: (id: string) => Promise<ToolAnswer | undefined>
}

const inputSchema = z
  .object({
    task_id: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe('A subagent’s id or name, or a background job id.'),
  })
  .strict()
type TaskStopInput = z.infer<typeof inputSchema>

/** A stopped run cannot be resumed as it was: a subagent restarts, a process is gone. */
const STOP: CallClass = { effect: 'session', irreversible: true }

/** Claude Code's older spelling, `shell_id`, names the same task. */
export function prepareTaskStopArguments(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const { shell_id: shellId, ...rest } = raw as Record<string, unknown>
  return shellId !== undefined && rest.task_id === undefined ? { ...rest, task_id: shellId } : rest
}

export function createTaskStopTool(ports: TaskStopPorts) {
  return defineAgentTool<TaskStopInput>({
    name: TOOL.TaskStop,
    label: 'Stop task',
    activeVerb: 'Stopping a task',
    description:
      'Stop a running subagent (by its id or name) or a background shell job (by its job id). A stopped subagent sends no reply; SendMessage to it resumes it.',
    inputSchema,
    prepareArguments: prepareTaskStopArguments,
    mutates: true,
    executionMode: 'parallel',
    classify: () => STOP,
    async execute(_toolCallId, input): Promise<ToolAnswer> {
      const child = ports.children ? await findChild(ports.children, input.task_id) : undefined
      if (child?.kind === 'found') return stopChild(ports.children!, child.run)
      const job = await ports.stopJob?.(input.task_id)
      if (job) return job
      return {
        content: `No subagent or background job "${input.task_id}" in this conversation.${
          child ? `\n${listChildren(child.runs)}` : ''
        }`,
        isError: true,
      }
    },
  })
}
