import { describe, expect, test } from 'bun:test'
import { createSubsessionRunner } from './subsession-runner'
import type { SessionLoop } from './contracts'

const loop: SessionLoop = {
  id: 'loop-1',
  userId: 'user-1',
  sessionId: 'parent-1',
  kind: 'fixed',
  cron: '*/5 * * * *',
  prompt: 'check status',
  maintenance: false,
  target: 'subsession',
  createdAt: '2026-07-20T00:00:00.000Z',
  nextRunAt: '2026-07-20T01:00:00.000Z',
  lastRunAt: null,
  lastStatus: null,
  lastError: null,
  runCount: 0,
}

describe('loop subsession runner', () => {
  test('an agent-armed loop runs as that agent on its own route, never the default agent', async () => {
    const reads: unknown[] = []
    const creates: Array<{ agents?: Array<{ agentId: string }> }> = []
    const fire = createSubsessionRunner({
      getParentSession: async (...args) => {
        reads.push(args)
        return { providerConnectionId: 'qa-provider', modelId: 'qa-model', projectId: 'project' }
      },
      createSession: async (_userId, input) => {
        creates.push(input)
        return { id: 'child-1' }
      },
      runJobTask: async () => {},
      childRuntimeStatus: async () => 'completed',
    })
    await fire({ ...loop, ownerAgentId: 'builtin:qa' }, loop.prompt, [])
    expect(reads).toEqual([['user-1', 'parent-1', 'builtin:qa']])
    expect(creates[0]).toMatchObject({
      agents: [{ agentId: 'builtin:qa' }],
      providerConnectionId: 'qa-provider',
      modelId: 'qa-model',
    })
    await fire(loop, loop.prompt, [])
    expect(creates[1]?.agents).toBeUndefined()
  })

  test('inherits parent policy and dispatches with loop provenance, never delegate provenance', async () => {
    const createInputs: Array<{
      provenance?: { kind: string; parentSessionId?: string; loopId?: string }
    }> = []
    const runOptions: Array<{
      invocation: { kind: string; parentSessionId?: string; loopId?: string }
    }> = []
    const fire = createSubsessionRunner({
      getParentSession: async () => ({
        providerConnectionId: 'provider',
        modelId: 'model',
        projectId: 'project',
      }),
      createSession: async (_userId, input) => {
        createInputs.push(input)
        return { id: 'child-1' }
      },
      runJobTask: async (_userId, _sessionId, _task, opts) => {
        runOptions.push(opts)
      },
      childRuntimeStatus: async () => 'completed',
    })

    expect(await fire(loop, loop.prompt, ['loops'])).toEqual({ ok: true })
    expect(createInputs[0]?.provenance).toEqual({
      kind: 'loop',
      parentSessionId: 'parent-1',
      loopId: 'loop-1',
    })
    expect(runOptions[0]?.invocation).toEqual({
      kind: 'loop-subsession',
      parentSessionId: 'parent-1',
      loopId: 'loop-1',
    })
    expect(runOptions[0]?.invocation).not.toEqual(
      expect.objectContaining({ kind: 'task-delegation' }),
    )
  })
})

describe('loop subsession runner — the round reports through its final reply', () => {
  const baseDeps = {
    getParentSession: async () => ({
      providerConnectionId: 'provider',
      modelId: 'model',
      projectId: 'project',
    }),
    createSession: async () => ({ id: 'child-2' }),
    runJobTask: async () => {},
    childRuntimeStatus: async () => 'completed',
  }

  test("the child's final reply is the handoff to the next round", async () => {
    const fire = createSubsessionRunner({
      ...baseDeps,
      childFinalText: async () => 'All checks pass.',
    })
    expect(await fire(loop, loop.prompt, ['loops'])).toEqual({
      ok: true,
      handoff: { summary: 'All checks pass.' },
    })
  })

  test('a round that said nothing hands nothing over — the next one inherits nothing', async () => {
    const fire = createSubsessionRunner({ ...baseDeps, childFinalText: async () => null })
    expect(await fire(loop, loop.prompt, ['loops'])).toEqual({ ok: true })
  })

  test('a child that did not complete is a failed fire, whatever it said', async () => {
    const fire = createSubsessionRunner({
      ...baseDeps,
      childRuntimeStatus: async () => 'failed',
      childFinalText: async () => 'partial',
    })
    expect(await fire(loop, loop.prompt, ['loops'])).toMatchObject({ ok: false })
  })
})
