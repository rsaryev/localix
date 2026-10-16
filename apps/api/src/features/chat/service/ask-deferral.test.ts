import { describe, expect, test } from 'bun:test'
import { createAskTool } from '../../agent-core/tools/hitl/ask'
import type { AskQueuePort } from '../../agent-core/tools/hitl/ask-queue'
import { createHitlRegistry } from '../runtime/hitl-registry'
import { createChatInteractionFacade, type ChatInteractionFacadeDeps } from './interaction-facade'

const questions = [{ id: 'db', question: 'Which database?', options: [{ label: 'Postgres' }] }]

function harness(recallId?: string, queueable = true) {
  const queued: unknown[] = []
  const superseded: string[] = []
  const events: unknown[] = []
  const endings: unknown[] = []
  const registry = createHitlRegistry({
    lifecycle: { raised: () => {}, ended: (ending) => void endings.push(ending) },
  })
  const queue: AskQueuePort = {
    queue: async (input) => {
      queued.push(input)
      return { questionId: 'q-4', superseded: [] }
    },
    recall: async () => ({ questions, openQuestionId: recallId }),
    supersede: async (id) => {
      superseded.push(id)
    },
  }
  const facade = createChatInteractionFacade({
    hitlRegistry: registry,
    streamRegistry: { publish: (...args: unknown[]) => events.push(args) },
  } as unknown as ChatInteractionFacadeDeps)
  const start = () =>
    createAskTool(queueable ? queue : undefined).execute(
      'call-1',
      recallId ? { from: recallId } : { questions },
      undefined,
      (details) => {
        if (details.request)
          registry.trackRequest('s1', 'm1', 'call-1', 'ask', details.request, 'alice')
      },
      { humanInLoop: registry.controller },
    )
  return { registry, facade, start, queued, superseded, events, endings }
}

describe('answering a waiting ask later', () => {
  test('releases the waiting tool, queues the original questions, and reports no answer', async () => {
    const h = harness()
    const pending = h.start()
    expect(h.registry.listPendingInteractions('s1')).toHaveLength(1)
    expect(h.facade.interact('call-1', 'defer', undefined, 'alice')).toEqual({ ok: true })
    const result = await pending
    expect(h.queued).toEqual([{ toolCallId: 'call-1', questions }])
    expect(result.details).toEqual({ queued: { questionId: 'q-4', status: 'pending' } })
    expect(result.details?.answers).toBeUndefined()
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('No option was chosen')
    expect(result.content).toContain('Continue with the work that does not depend on the answer')
    expect(h.registry.listPendingInteractions('s1')).toEqual([])
    expect(h.registry.getRequestMeta('call-1')).toBeNull()
    expect(h.events).toMatchObject([['alice', 's1', { type: 'hitl.resolved', reason: 'deferred' }]])
    expect(h.endings).toEqual([{ userId: 'alice', requestId: 'call-1', reason: 'deferred' }])
    h.registry.clearRequest('call-1')
    expect(h.endings).toHaveLength(1)
    expect(h.facade.interact('call-1', 'defer', undefined, 'alice').ok).toBe(false)
  })

  test('deferring a blocking recall preserves its q-N without creating or closing a question', async () => {
    const h = harness('q-3')
    const pending = h.start()
    for (let tick = 0; tick < 20 && !h.registry.controller.getPending('call-1'); tick++)
      await Promise.resolve()
    expect(h.facade.interact('call-1', 'defer', undefined, 'alice')).toEqual({ ok: true })
    const result = await pending
    expect(h.queued).toEqual([])
    expect(h.superseded).toEqual([])
    expect(result.details).toEqual({ questions, stillOpen: 'q-3' })
  })

  test('a different user cannot release the request or enqueue its questions', async () => {
    const h = harness()
    const pending = h.start()
    expect(h.facade.interact('call-1', 'defer', undefined, 'mallory').ok).toBe(false)
    expect(h.registry.listPendingInteractions('s1')).toHaveLength(1)
    expect(h.queued).toEqual([])
    h.facade.interact('call-1', 'respond', { answers: [] }, 'alice')
    await pending
  })

  test('a host without a question queue keeps the request waiting', async () => {
    const h = harness(undefined, false)
    const pending = h.start()
    expect(h.facade.interact('call-1', 'defer', undefined, 'alice').ok).toBe(false)
    expect(h.registry.listPendingInteractions('s1')).toHaveLength(1)
    h.facade.interact('call-1', 'respond', { answers: [] }, 'alice')
    await pending
  })

  test('a permission request cannot be deferred', async () => {
    const h = harness()
    const request = {
      id: 'permission',
      kind: 'confirm',
      payload: { canDefer: true },
      createdAt: Date.now(),
    }
    const pending = h.registry.controller.request(request)
    h.registry.trackRequest('s1', 'm1', 'permission', 'bash', request, 'alice')
    expect(h.facade.interact('permission', 'defer', undefined, 'alice').ok).toBe(false)
    expect(h.registry.controller.getPending('permission')).toBeDefined()
    h.facade.interact('permission', 'respond', { answers: { approved: false } }, 'alice')
    await pending
  })
})
