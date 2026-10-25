import { describe, expect, test } from 'bun:test'
import { realpathSync } from 'node:fs'
import { tempDirPerTest } from '@localixai/testing'

import { deliverHeldReport } from '../../../agent-core/delegation-awaits'
import { resolveRunProfile } from '../../../agent-core/run-shape'
import type { TaskDelegationOptions } from '../../../agent-core/tools/task-delegation'
import { workflowConcurrency } from '../../../agent-core/tools/workflow/agent-route'
import type { WorktreeHook } from '../../../agent-core/tools/workflow/hook-worktree'
import type { SessionRecord } from '../../repository'
import { buildWorkflowOptions } from './workflow-options'

/**
 * `workflow` rides a chat only once a workflow command activated it there, and only where the chat
 * can create children: a chat that never ran a workflow carries no schema for it.
 */
const scripts = {
  run: async () => ({ ok: true as const, value: undefined, output: [] }),
  declare: () => '',
}
const taskDelegation = {} as TaskDelegationOptions
const listWorkflows = async () => []
const tmp = tempDirPerTest('workflow-options-')
const chat = (activatedTools: string[]) =>
  ({ id: 's', sessionKind: 'chat', activatedTools }) as unknown as SessionRecord

const build = (
  session: SessionRecord,
  extra: Partial<Parameters<typeof buildWorkflowOptions>[0]> = {},
) =>
  buildWorkflowOptions({
    userId: 'u',
    session,
    agentProfile: resolveRunProfile(session),
    taskDelegation,
    scripts,
    listWorkflows,
    defaultCwd: '/repo',
    runsRoot: '/runs',
    ...extra,
  })

describe('buildWorkflowOptions', () => {
  test('absent until a workflow command activates it for the session', () => {
    expect(build(chat([]))).toBeUndefined()
    expect(build(chat(['workflow']))).toMatchObject({ scripts, list: listWorkflows })
  })

  test('absent without children, a sandbox, or a subagent shape', () => {
    expect(build(chat(['workflow']), { taskDelegation: undefined })).toBeUndefined()
    expect(build(chat(['workflow']), { scripts: undefined })).toBeUndefined()
    const child = { ...chat(['workflow']), sessionKind: 'subagent' } as SessionRecord
    expect(build(child)).toBeUndefined()
  })

  test('an agent runs in its run’s own lanes, on the model the script names; runs journal per conversation', async () => {
    const inputs: Array<Parameters<TaskDelegationOptions['createSession']>[1]> = []
    const starts: Array<Parameters<TaskDelegationOptions['startSubagentTask']>[3]> = []
    const delegation = {
      userId: 'u',
      parentSessionId: 's',
      position: () => ({ depth: 0, chain: [], self: 'builtin:localix' }),
      resolveAgent: (reference: string) => ({ agentId: reference, handle: 'localix' }),
      resolveTarget: () => ({ kind: 'unavailable' as const }),
      createSession: async (_user, input) => {
        inputs.push(input)
        return { id: `child-${inputs.length}` }
      },
      startSubagentTask: async (_user, sessionId, _task, opts) => {
        starts.push(opts)
        deliverHeldReport(sessionId, { status: 'completed', text: 'done' })
        return undefined
      },
    } satisfies TaskDelegationOptions
    const port = build(chat(['workflow']), {
      taskDelegation: delegation,
      chatModel: { providerId: 'anthropic', connectionId: 'conn', modelId: 'claude-opus-4-8' },
      catalog: [
        { id: 'claude-haiku-4-5', providerId: 'anthropic' },
        { id: 'claude-opus-4-8', providerId: 'anthropic' },
      ],
    })!
    const outcome = await port.runAgent(
      'call',
      'acme:audit',
      { prompt: 'go', label: 'go', ordinal: 1, model: 'haiku', effort: 'low' },
      new AbortController().signal,
      'wf-000000000001',
    )
    expect(outcome?.text).toBe('done')
    expect(inputs[0]).toMatchObject({
      providerConnectionId: 'conn',
      modelId: 'claude-haiku-4-5',
      reasoningEffort: 'low',
    })
    expect(starts[0]?.lane).toEqual({ key: 'workflow:wf-000000000001', cap: workflowConcurrency() })
    expect(port.runs?.dirOf('wf-000000000001')).toBe('/runs/s/wf-000000000001')
  })

  test('an isolated agent gets the worktree the run’s WorktreeCreate hook made; without one, git', async () => {
    const folder = realpathSync(tmp())
    const inputs: Array<Parameters<TaskDelegationOptions['createSession']>[1]> = []
    const delegation = {
      userId: 'u',
      parentSessionId: 's',
      position: () => ({ depth: 0, chain: [], self: 'builtin:localix' }),
      resolveAgent: (reference: string) => ({ agentId: reference, handle: 'localix' }),
      resolveTarget: () => ({ kind: 'unavailable' as const }),
      createSession: async (_user, input) => {
        inputs.push(input)
        return { id: `child-${inputs.length}` }
      },
      startSubagentTask: async (_user, sessionId) => {
        deliverHeldReport(sessionId, { status: 'completed', text: 'done' })
        return undefined
      },
    } satisfies TaskDelegationOptions
    const named: string[] = []
    const run = (worktreeHook: WorktreeHook) =>
      build(chat(['workflow']), {
        taskDelegation: delegation,
        defaultCwd: folder,
        worktreeHook,
      })!.runAgent(
        'call',
        'acme:audit',
        { prompt: 'go', label: 'go', ordinal: 3, isolation: 'worktree' },
        new AbortController().signal,
        'wf-000000000001',
      )
    const outcome = await run(async (name) => {
      named.push(name)
      return { ok: true, path: '.', cwd: folder }
    })
    expect(named).toEqual(['wf-000000000001-3'])
    expect(inputs[0]?.provenance).toMatchObject({ workingDir: folder, worktreeByHook: true })
    expect(outcome?.notes?.[0]).toContain('which the WorktreeCreate hook made; it is kept')
    // The hook's failure fails the agent; no handler that ran leaves it to git.
    await expect(run(async () => ({ ok: false, error: 'no svn' }))).rejects.toThrow('no svn')
    await expect(run(async () => undefined)).rejects.toThrow('git repository')
  })
})
