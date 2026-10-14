import { describe, expect, test } from 'bun:test'
import type { StoredMessagePayload } from '../../../../db'
import { createRuntimeState } from '../agent-runner-state'
import { createItemAccumulator } from '../items'
import { createMemoryWorkRepository } from '../../../work/memory-repository'
import { createWorkRegistry } from '../../../work/registry'
import { createRunAsyncRegistry } from './async-registry'
import { createRunTurnState } from './turn-state'
import { emptyAssistantPayload } from '../message-envelope'
import { emptySessionTiming } from '../../session-timing'
import { DEFAULT_AGENT_PARTICIPANT } from '../../../../db'
import type { RunEnv } from './types'

function setup() {
  const acc = createItemAccumulator(() => 'Running')
  acc.startTool(0, 'old', 'bash', { command: 'build' })
  const payload = {
    ...emptyAssistantPayload('first', DEFAULT_AGENT_PARTICIPANT),
    items: acc.list(),
  }
  const state = createRunTurnState({
    payload,
    assistantCreatedAt: '2026-01-01T00:00:00Z',
    baseSessionTiming: emptySessionTiming(),
  })
  state.pendingTools.set('old', { name: 'bash', input: { command: 'build' } } as never)
  const runtime = createRuntimeState(createWorkRegistry({ repo: createMemoryWorkRepository() }))
  const stored = new Map<string, StoredMessagePayload>([['first', payload]])
  const writes: string[] = []
  const env = {
    state: runtime,
    repo: {
      getMessage: async (_user: string, _session: string, id: string) =>
        stored.has(id) ? { id, payload: stored.get(id), createdAt: '2026-01-01T00:00:00Z' } : null,
    },
    deps: { streamRegistry: { publish: () => {} } },
    persistAndPublish: async (
      _user: string,
      _session: string,
      id: string,
      next: StoredMessagePayload,
    ) => {
      writes.push(id)
      stored.set(id, next)
    },
    queueMidRunReminder: () => {},
  } as unknown as RunEnv
  const registry = createRunAsyncRegistry({
    env,
    state,
    abort: new AbortController(),
    userId: 'u',
    session: { id: 's' } as never,
    agentId: 'localix',
    assistantMessageId: 'first',
    backgroundToolNames: new Set(),
    patchLiveItem: (id, patch) => {
      acc.patchToolItem(id, patch)
    },
  })
  const actions = {
    kill: { label: 'Stop', execute: () => {} },
    send_input: { label: 'Send', execute: () => {} },
  }
  const dispose = registry.registerActions('old', actions)
  const split = () => {
    acc.reset()
    const next = {
      ...emptyAssistantPayload('second', DEFAULT_AGENT_PARTICIPANT),
      content: 'New work',
    }
    state.currentPayload = next
    state.payload = next
    stored.set('second', next)
  }
  return { registry, state, acc, stored, writes, split, runtime, actions, env, dispose }
}

describe('background item row ownership', () => {
  test('removing actions waits for a pending background write to the same sealed row', async () => {
    const h = setup()
    h.split()
    let started!: () => void
    let release!: () => void
    let finished!: () => void
    const admitted = new Promise<void>((resolve) => {
      started = resolve
    })
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const completed = new Promise<void>((resolve) => {
      finished = resolve
    })
    const persist = h.env.persistAndPublish
    let writes = 0
    h.env.persistAndPublish = async (...args) => {
      writes += 1
      if (writes === 1) {
        started()
        await blocked
      }
      await persist(...args)
      if (writes === 2) finished()
    }

    h.registry.emitBackground('old', 'Finished build', { done: true, exitCode: 0 })
    try {
      await admitted
      h.dispose()
      await Bun.sleep(0)
      expect(writes).toBe(1)
    } finally {
      release()
    }
    await completed
    expect(h.stored.get('first')?.items?.[0]).toMatchObject({
      status: 'completed',
      resultText: 'Finished build',
      actions: undefined,
    })
    expect(h.stored.get('second')?.content).toBe('New work')
  })

  test('a late job result patches its original row and cannot overwrite the continuation', async () => {
    const h = setup()
    h.split()
    const current = h.state.currentPayload
    h.registry.emitBackground('old', 'Finished build', { done: true, exitCode: 0 })
    await Bun.sleep(0)
    expect(h.state.currentPayload).toBe(current)
    expect(h.acc.list()).toEqual([])
    expect(h.stored.get('first')?.items?.[0]).toMatchObject({
      status: 'completed',
      resultText: 'Finished build',
      turnIndex: 0,
    })
    expect(h.stored.get('second')?.content).toBe('New work')
    expect(h.writes.at(-1)).toBe('first')
  })

  test('a job created after the split is recorded and published under the fresh row', () => {
    const h = setup()
    h.split()
    h.acc.startTool(1, 'new', 'bash', { command: 'test' })
    h.state.currentPayload = { ...h.state.currentPayload, items: h.acc.list() }
    h.state.pendingTools.set('new', { name: 'bash', input: { command: 'test' } } as never)
    h.registry.registerActions('new', h.actions)
    expect(h.runtime.work.get('new')?.messageId).toBe('second')
    h.registry.emitBackground('new', 'Done', { done: true, exitCode: 0 })
    expect(h.writes.at(-1)).toBe('second')
  })

  test('live results survive the next accumulator snapshot and a deleted owner is not resurrected', async () => {
    const h = setup()
    h.registry.emitBackground('old', 'Done', { done: true, exitCode: 0 })
    expect(h.acc.list()[0]).toMatchObject({ status: 'completed', resultText: 'Done' })
    expect(h.state.payload).toBe(h.state.currentPayload)
    h.split()
    h.stored.delete('first')
    const writes = h.writes.length
    h.registry.emitBackground('old', 'Late output', { done: true, exitCode: 0 })
    await Bun.sleep(0)
    expect(h.writes).toHaveLength(writes)
    expect(h.stored.has('first')).toBe(false)
    expect(h.state.currentPayload.content).toBe('New work')
  })
})
