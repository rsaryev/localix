import { describe, expect, test } from 'bun:test'

import type { AgentControlPorts, ChildRunSummary } from './agent-control'
import { createTaskStopTool, type TaskStopPorts } from './task-stop'

const RUNS: ChildRunSummary[] = [
  {
    sessionId: 's1',
    taskName: 'check-login',
    title: 'Check login',
    name: 'check-login',
    status: 'running',
    level: 1,
  },
  { sessionId: 's2', taskName: 'audit', status: 'completed', level: 1 },
  { sessionId: 's3', taskName: 'later', status: 'queued (#1)', waitingForLane: true, level: 1 },
]

function ports(over: Partial<TaskStopPorts> = {}) {
  const stopped: string[] = []
  const jobs: string[] = []
  const children: AgentControlPorts = {
    listRuns: async () => RUNS,
    message: async () => ({ delivered: true, state: 'running' }),
    stop: async (sessionId) => void stopped.push(sessionId),
  }
  const value: TaskStopPorts = {
    children,
    stopJob: async (id) => {
      if (id !== 'job-7') return undefined
      jobs.push(id)
      return { content: 'Stop requested for job job-7.' }
    },
    ...over,
  }
  return { value, stopped, jobs }
}

function stop(target: TaskStopPorts, input: Record<string, unknown>) {
  const tool = createTaskStopTool(target)
  const prepared = tool.prepareArguments ? tool.prepareArguments(input) : input
  const parsed = tool.inputSchema.safeParse(prepared)
  if (!parsed.success) return Promise.resolve({ content: 'invalid', isError: true })
  return tool.execute('call-1', parsed.data as never, undefined, undefined, undefined)
}

describe('TaskStop', () => {
  test('stops a running subagent by its description or id', async () => {
    const { value, stopped } = ports()
    const out = await stop(value, { task_id: 'check-login' })
    expect(stopped).toEqual(['s1'])
    expect(out.isError).toBeUndefined()
    expect(out.content).toContain('SendMessage')
  })

  test('a subagent that is not running has nothing to stop', async () => {
    const { value, stopped } = ports()
    expect((await stop(value, { task_id: 's2' })).isError).toBe(true)
    expect(stopped).toEqual([])
  })

  test('a subagent still waiting for a lane is withdrawn, not refused', async () => {
    const { value, stopped } = ports()
    const out = await stop(value, { task_id: 'later' })
    expect(stopped).toEqual(['s3'])
    expect(out.isError).toBeUndefined()
    expect(out.content).toContain('queue')
  })

  test('stops a background shell job by its id', async () => {
    const { value, jobs, stopped } = ports()
    const out = await stop(value, { task_id: 'job-7' })
    expect(jobs).toEqual(['job-7'])
    expect(stopped).toEqual([])
    expect(out.isError).toBeUndefined()
  })

  test('Claude Code’s older shell_id names the same task', async () => {
    const { value, jobs } = ports()
    await stop(value, { shell_id: 'job-7' })
    expect(jobs).toEqual(['job-7'])
  })

  test('an id that is neither is refused, and the answer lists the subagents it could mean', async () => {
    const { value, stopped, jobs } = ports()
    const out = await stop(value, { task_id: 'nothing' })
    expect(out.isError).toBe(true)
    expect(out.content).toContain('s1')
    expect(out.content).toContain('Check login')
    expect(stopped).toEqual([])
    expect(jobs).toEqual([])
  })

  test('stopping by the name its call gave, and a description is not a name', async () => {
    const { value, stopped } = ports()
    expect((await stop(value, { task_id: 'check login' })).isError).toBe(true)
    await stop(value, { task_id: 'check-login' })
    expect(stopped).toEqual(['s1'])
  })

  test('the answer says what the subagent was doing when it was stopped', async () => {
    const { value } = ports()
    expect((await stop(value, { task_id: 's1' })).content).toContain('running')
  })
})
