import { describe, expect, test } from 'bun:test'

import { MAX_TASK_STATES, setMessageTask } from './message-tasks'

function io(payload: Record<string, unknown>) {
  const updates: unknown[] = []
  const published: unknown[] = []
  let stored = { id: 'm1', role: 'assistant', ...payload }
  return {
    updates,
    published,
    io: {
      repo: {
        getMessage: async () => ({ id: 'm1', createdAt: 't0', payload: stored }),
        updateMessage: async (_u: string, _s: string, _id: string, patch: object) => {
          updates.push(patch)
          stored = { ...stored, ...patch }
          return { payload: stored }
        },
      },
      streamRegistry: { publish: (...args: unknown[]) => published.push(args) },
      now: () => 't1',
    } as never,
  }
}

const tick = (h: ReturnType<typeof io>, key: string, checked: boolean) =>
  setMessageTask(h.io, { userId: 'u', sessionId: 's', messageId: 'm1', key, checked })

describe('ticking a box in a reply', () => {
  test('stores the mark on the message and publishes the row', async () => {
    const h = io({})
    expect(await tick(h, 'content:0', true)).toBe(true)
    expect(h.updates).toEqual([{ taskStates: { 'content:0': true } }])
    expect(h.published).toHaveLength(1)
  })

  test('an unticked box is stored too — it may override a `[x]` in the source', async () => {
    const h = io({})
    expect(await tick(h, 'content:4', false)).toBe(true)
    expect(h.updates).toEqual([{ taskStates: { 'content:4': false } }])
  })

  test('the same mark again writes nothing', async () => {
    const h = io({ taskStates: { 'content:0': true } })
    expect(await tick(h, 'content:0', true)).toBe(false)
    expect(h.updates).toEqual([])
  })

  test("the person's own message has no checklist of the agent's to tick", async () => {
    const h = io({ role: 'user' })
    expect(await tick(h, 'content:0', true)).toBe(false)
  })

  test('the number of stored marks is bounded', async () => {
    const full = Object.fromEntries(
      Array.from({ length: MAX_TASK_STATES }, (_, i) => [`content:${i}`, true]),
    )
    const h = io({ taskStates: full })
    expect(await tick(h, 'content:new', true)).toBe(false)
  })
})
