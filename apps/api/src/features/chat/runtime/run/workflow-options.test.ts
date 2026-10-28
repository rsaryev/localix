import { afterEach, describe, expect, test } from 'bun:test'
import { realpathSync } from 'node:fs'
import { tempDirPerTest } from '@localixai/testing'

import { deliverHeldReport } from '../../../agent-core/delegation-awaits'
import {
  __resetDelegationLanes,
  laneOf,
  releaseLane,
  requestLane,
} from '../../../agent-core/delegation-lanes'
import { resolveRunProfile } from '../../../agent-core/run-shape'
import type { TaskDelegationOptions } from '../../../agent-core/tools/task-delegation'
import { workflowConcurrency } from '../../../agent-core/tools/workflow/agent-route'
import type { WorktreeHook } from '../../../agent-core/tools/workflow/hook-worktree'
import type { SessionRecord } from '../../repository'
import { setAgentService } from '../agent-service-binding'
import { buildWorkflowOptions } from './workflow-options'

/**
 * `workflow` is built for every chat that can create children. It waits behind `ToolSearch` until
 * the model loads it or a workflow command activates it (`tool-deferral.test.ts`).
 */
const scripts = {
  run: async () => ({ ok: true as const, value: undefined, output: [] }),
}
const taskDelegation = {} as TaskDelegationOptions
const listWorkflows = async () => []
const tmp = tempDirPerTest('workflow-options-')
const chat = (activatedTools: string[]) =>
  ({ id: 's', sessionKind: 'chat', activatedTools }) as unknown as SessionRecord

/** Let the pending promise chains run: no timer, so the test never sleeps. */
const settle = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

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
  test('present in a chat that never ran a workflow command, so ToolSearch can load it', () => {
    expect(build(chat([]))).toMatchObject({ scripts, list: listWorkflows })
  })

  test('absent without children, a sandbox, or a subagent shape', () => {
    expect(build(chat(['Workflow']), { taskDelegation: undefined })).toBeUndefined()
    expect(build(chat(['Workflow']), { scripts: undefined })).toBeUndefined()
    const child = { ...chat(['Workflow']), sessionKind: 'subagent' } as SessionRecord
    expect(build(child)).toBeUndefined()
  })

  test('an agent runs in its run’s own lanes, on the model the script names; runs journal per conversation', async () => {
    const inputs: Array<Parameters<TaskDelegationOptions['createSession']>[1]> = []
    const starts: Array<Parameters<TaskDelegationOptions['startSubagentTask']>[3]> = []
    const delegation = {
      userId: 'u',
      parentSessionId: 's',
      position: () => ({ depth: 0, chain: [], self: 'builtin:localix' }),
      resolveAgent: (reference: string) => ({ agentId: reference, name: 'localix' }),
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
    const port = build(chat(['Workflow']), {
      taskDelegation: delegation,
    })!
    const outcome = await port.runAgent(
      'call',
      'acme:audit',
      { prompt: 'go', label: 'go', ordinal: 1 },
      new AbortController().signal,
      'wf-000000000001',
    )
    expect(outcome?.text).toBe('done')
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
      resolveAgent: (reference: string) => ({ agentId: reference, name: 'localix' }),
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
      build(chat(['Workflow']), {
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

  test('an agent waiting for a lane when the script settles leaves the queue and never starts', async () => {
    const stopped: string[] = []
    const recorded: string[] = []
    setAgentService({
      stopSession: async (id: string) => void stopped.push(id),
      recordChildStopped: async (_user: string, id: string) => void recorded.push(id),
    } as never)
    const lane = { key: 'workflow:wf-000000000001', cap: 1 }
    requestLane('s', 'busy', () => {}, 'normal', lane)
    const started: string[] = []
    const delegation = {
      userId: 'u',
      parentSessionId: 's',
      position: () => ({ depth: 0, chain: [], self: 'builtin:localix' }),
      resolveAgent: (reference: string) => ({ agentId: reference, name: 'localix' }),
      resolveTarget: () => ({ kind: 'unavailable' as const }),
      createSession: async () => ({ id: 'child-1' }),
      startSubagentTask: async (_user, sessionId, _task, opts) => {
        const admission = requestLane(
          's',
          sessionId,
          () => void started.push(sessionId),
          'normal',
          opts.lane,
        )
        return admission.state === 'queued' ? { queued: admission.position } : undefined
      },
    } satisfies TaskDelegationOptions
    const script = new AbortController()
    const outcome = build(chat([]), { taskDelegation: delegation })!.runAgent(
      'call',
      'acme:audit',
      { prompt: 'go', label: 'go', ordinal: 1 },
      script.signal,
      'wf-000000000001',
    )
    await settle()
    expect(laneOf('child-1')?.state).toBe('queued')
    script.abort()
    expect(await outcome).toMatchObject({ text: null })
    await settle()

    expect(laneOf('child-1')).toBeUndefined()
    releaseLane('busy')
    expect(started).toEqual([])
    expect(recorded).toEqual(['child-1'])
    expect(stopped).toEqual([])
  })
})

afterEach(() => {
  setAgentService(null as never)
  __resetDelegationLanes()
})
