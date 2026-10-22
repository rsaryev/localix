import { describe, expect, test } from 'bun:test'

import { deliverHeldReport } from '../../delegation-awaits'
import type { TaskDelegationOptions } from '../task-delegation'
import { startWorkflowAgent, type WorkflowAgentDeps } from './agent-start'

/**
 * A workflow's agent is a child of the chat, started as `delegate` starts one, and the call
 * waits for its report: completed is the text, anything else is null (the script's `null`).
 */
function options(
  report: { status: 'completed' | 'failed'; text: string } | null,
  onStart?: () => void,
) {
  const created: Array<{ title: string; agentId: string }> = []
  const inputs: Array<Parameters<TaskDelegationOptions['createSession']>[1]> = []
  const starts: Array<Parameters<TaskDelegationOptions['startSubagentTask']>[3]> = []
  const tasks: string[] = []
  const opts: TaskDelegationOptions = {
    userId: 'u',
    parentSessionId: 'chat',
    position: () => ({ depth: 0, chain: [], self: 'builtin:localix' }),
    resolveAgent: (reference) =>
      reference === 'builtin:localix' || reference === 'reviewer'
        ? { agentId: reference === 'reviewer' ? 'agent:reviewer' : reference, handle: reference }
        : null,
    // Many agents run in one workflow: the per-turn delegation budget is never asked.
    delegationsSinceHuman: () => 10_000,
    createSession: async (_user, input) => {
      inputs.push(input)
      created.push({ title: input.title, agentId: input.agents[0]!.agentId })
      return { id: `child-${created.length}` }
    },
    startSubagentTask: async (_user, sessionId, task, startOpts) => {
      tasks.push(task)
      starts.push(startOpts)
      onStart?.()
      if (report) deliverHeldReport(sessionId, report)
      return undefined
    },
    copyConversation: async () => {},
  }
  return { opts, created, tasks, inputs, starts }
}

const deps = (
  opts: TaskDelegationOptions,
  stop: (id: string) => Promise<void> = async () => {},
  extra: Partial<WorkflowAgentDeps> = {},
): WorkflowAgentDeps => ({ opts, stop, run: { id: 'wf-000000000001' }, ...extra })

const request = { prompt: 'Audit a.ts', label: 'a.ts', ordinal: 1 }

describe('startWorkflowAgent', () => {
  test('creates a child of the chat and returns its report', async () => {
    const { opts, created, tasks } = options({ status: 'completed', text: 'all good' })
    const stopped: string[] = []
    const outcome = await startWorkflowAgent(
      'call-1',
      'acme:audit',
      request,
      deps(opts, async (id) => void stopped.push(id)),
      new AbortController().signal,
    )
    expect(outcome).toEqual({ text: 'all good', notes: [] })
    expect(created).toEqual([{ title: 'acme:audit · a.ts', agentId: 'builtin:localix' }])
    expect(tasks[0]).toContain('returned to the workflow script as data')
    expect(tasks[0]).toContain('# Task\nAudit a.ts')
    expect(stopped).toEqual([])
  })

  test('agentType picks the agent; an unknown one fails the call', async () => {
    const { opts, created } = options({ status: 'completed', text: 'x' })
    const signal = new AbortController().signal
    await startWorkflowAgent('c', 'w', { ...request, agentType: 'reviewer' }, deps(opts), signal)
    expect(created[0]?.agentId).toBe('agent:reviewer')
    await expect(
      startWorkflowAgent('c', 'w', { ...request, agentType: 'ghost' }, deps(opts), signal),
    ).rejects.toThrow('No enabled agent "ghost"')
  })

  test('an agentType naming a plugin agent runs the child as that type', async () => {
    const { opts, created, inputs, starts } = options({ status: 'completed', text: 'x' })
    const reviewer = {
      plugin: 'sec-kit',
      name: 'reviewer',
      fullName: 'sec-kit:reviewer',
      description: 'Reviews code for security problems',
      maxTurns: 4,
      pinnedSkills: ['threat-model'],
    }
    const plugins = { agents: () => [reviewer] } as unknown as WorkflowAgentDeps['plugins']
    await startWorkflowAgent(
      'c',
      'w',
      { ...request, agentType: 'sec-kit:reviewer' },
      deps(opts, undefined, { plugins }),
      new AbortController().signal,
    )
    // The delegating agent is seated; the stored type gives every run the agent's prompt and tools.
    expect(created[0]?.agentId).toBe('builtin:localix')
    expect(inputs[0]?.provenance).toMatchObject({ pluginAgent: 'sec-kit:reviewer' })
    expect(inputs[0]).toMatchObject({ pinnedSkills: ['threat-model'] })
    expect(starts[0]).toMatchObject({ maxTurns: 4, label: 'agent sec-kit:reviewer' })
  })

  test('a failed report is null; an abort stops the child and returns null', async () => {
    const failed = options({ status: 'failed', text: 'boom' })
    const signal = new AbortController().signal
    expect(
      (await startWorkflowAgent('c', 'w', request, deps(failed.opts), signal))?.text,
    ).toBeNull()

    // The person stops the run while the agent works: the child is stopped with it.
    const controller = new AbortController()
    const pending = options(null, () => controller.abort())
    const stopped: string[] = []
    const outcome = await startWorkflowAgent(
      'c',
      'w',
      request,
      deps(pending.opts, async (id) => void stopped.push(id)),
      controller.signal,
    )
    expect(outcome?.text).toBeNull()
    expect(stopped).toEqual(['child-1'])
  })

  test('model and effort give the child a route of its own; it runs in its run’s lane', async () => {
    const { opts, inputs, starts } = options({ status: 'completed', text: 'x' })
    const lane = { key: 'workflow:wf-000000000001', cap: 16 }
    const outcome = await startWorkflowAgent(
      'c',
      'w',
      { ...request, model: 'haiku', effort: 'low' },
      deps(opts, undefined, {
        run: { id: 'wf-000000000001', lane },
        route: async (asked) => ({
          route: { providerConnectionId: 'conn', modelId: `claude-${asked.model}-4-5` },
          notes: ['effort low applied'],
        }),
        spend: async () => ({ outputTokens: 321, costUsd: 0.5 }),
      }),
      new AbortController().signal,
    )
    expect(inputs[0]).toMatchObject({ providerConnectionId: 'conn', modelId: 'claude-haiku-4-5' })
    expect(starts[0]?.lane).toEqual(lane)
    expect(outcome).toEqual({ text: 'x', tokens: 321, costUsd: 0.5, notes: ['effort low applied'] })
  })

  test('isolation gives the child a worktree, which is finished when it ends', async () => {
    const { opts, inputs } = options({ status: 'completed', text: 'edited' })
    const named: string[] = []
    let finished = 0
    const outcome = await startWorkflowAgent(
      'c',
      'w',
      { ...request, isolation: 'worktree', ordinal: 7 },
      deps(opts, undefined, {
        isolate: async (name) => {
          named.push(name)
          return {
            dir: '/wt/wf-000000000001-7',
            workingDir: '/wt/wf-000000000001-7/pkg',
            branch: 'localix/workflow/wf-000000000001-7',
            finish: async () => ({ kept: ++finished > 0 }),
          }
        },
      }),
      new AbortController().signal,
    )
    expect(named).toEqual(['wf-000000000001-7'])
    expect(inputs[0]?.provenance.workingDir).toBe('/wt/wf-000000000001-7/pkg')
    expect(finished).toBe(1)
    expect(outcome?.notes?.[0]).toContain('left its changes in the worktree /wt/wf-000000000001-7')
    // Without a worktree port the option fails the call rather than sharing the chat's folder.
    await expect(
      startWorkflowAgent(
        'c',
        'w',
        { ...request, isolation: 'worktree' },
        deps(opts),
        new AbortController().signal,
      ),
    ).rejects.toThrow("isolation: 'worktree' is not available")
  })

  test('a worktree a WorktreeCreate hook made is marked on the child and kept, as in Claude Code', async () => {
    const { opts, inputs } = options({ status: 'completed', text: 'edited' })
    const outcome = await startWorkflowAgent(
      'c',
      'w',
      { ...request, isolation: 'worktree' },
      deps(opts, undefined, {
        isolate: async () => ({
          dir: '/srv/wt/a',
          workingDir: '/srv/wt/a',
          byHook: true,
          finish: async () => ({ kept: true }),
        }),
      }),
      new AbortController().signal,
    )
    expect(inputs[0]?.provenance).toMatchObject({ workingDir: '/srv/wt/a', worktreeByHook: true })
    expect(outcome?.notes?.[0]).toBe(
      'agent "a.ts" worked in /srv/wt/a, which the WorktreeCreate hook made; it is kept, remove it when the work is done',
    )
  })
})
