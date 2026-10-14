import { describe, expect, test } from 'bun:test'
import { createHumanInLoopController, HumanInLoopDismissedError } from '@localixai/agent/agents'

import { createAskTool } from './ask'
import type { AskQueuePort } from './ask-queue'
import { HITL_DECISION_MS } from './decision-deadline'

const questions = [
  { id: 'db', question: 'Which database?', options: [{ label: 'Postgres' }, { label: 'SQLite' }] },
]

/** A host queue whose every method answers a default; `overrides` replaces any of them. */
function port(overrides: Partial<AskQueuePort> = {}): AskQueuePort {
  return {
    queue: async () => ({ questionId: 'q-9', superseded: [] }),
    recall: async () => ({ refused: 'unknown' }),
    supersede: async () => {},
    ...overrides,
  }
}

describe('ask with wait: false', () => {
  test('queues the question and returns at once — nothing blocks on a person', async () => {
    const humanInLoop = createHumanInLoopController()
    const queued: unknown[] = []
    const tool = createAskTool(
      port({
        queue: async (input) => {
          queued.push(input)
          return { questionId: 'q-4', superseded: [] }
        },
      }),
    )
    const result = await tool.execute('call_9', { questions, wait: false }, undefined, undefined, {
      humanInLoop,
    })
    expect(queued).toEqual([{ toolCallId: 'call_9', questions }])
    // No card was raised: the blocking path's controller never saw a request.
    expect(humanInLoop.listPending()).toHaveLength(0)
    expect(result.isError).toBeUndefined()
    expect(result.details).toEqual({ queued: { questionId: 'q-4', status: 'pending' } })
    // The agent is told the id, to keep working, and not to re-ask or poll.
    expect(result.content).toContain('Queued as q-4')
    expect(result.content).toContain('do not ask it again as a new question')
    // …and the one sanctioned way to wait for it after all, by id.
    expect(result.content).toContain('from: "q-4"')
  })

  test('names the questions a re-ask replaced', async () => {
    const tool = createAskTool(
      port({ queue: async () => ({ questionId: 'q-2', superseded: ['q-1'] }) }),
    )
    const result = await tool.execute('call_1', { questions, wait: false })
    expect(result.content).toContain('replaces q-1')
  })

  test('is refused with a way forward when the host has no queue', async () => {
    const result = await createAskTool().execute('call_1', { questions, wait: false })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('wait: true')
  })
})

/**
 * Re-asking by id: the agent holds `q-3` (or an earlier call's id) and passes THAT, instead of
 * generating the question again — the `tool_output`-by-call-id shape.
 */
describe('ask with from', () => {
  test('waiting on an open queued question asks it as a card, and closes it once ANSWERED', async () => {
    const humanInLoop = createHumanInLoopController()
    const superseded: string[] = []
    const tool = createAskTool(
      port({
        recall: async () => ({ questions, openQuestionId: 'q-3' }),
        supersede: async (id) => void superseded.push(id),
      }),
    )
    const pending = tool.execute('call_2', { from: 'q-3' }, undefined, undefined, { humanInLoop })
    // A recall looks the question up first; let it reach the card.
    for (let tick = 0; tick < 20 && humanInLoop.listPending().length === 0; tick++)
      await Promise.resolve()
    // Still open while the card waits: a restart or a stop mid-wait must not lose it.
    expect(superseded).toEqual([])
    const card = humanInLoop.listPending()[0]
    expect(card).toBeDefined()
    expect((card!.request.payload as { questions: unknown }).questions).toEqual(questions)
    humanInLoop.respond({
      requestId: 'call_2',
      kind: 'ask',
      payload: {
        answers: [{ id: 'db', question: 'Which database?', selectedOptions: ['SQLite'] }],
      },
      respondedAt: Date.now(),
    })
    const result = await pending
    expect(result.content).toBe('User answers:\ndb: SQLite')
    // Answered here, so the queued copy closes — no second answer, no second wake.
    expect(superseded).toEqual(['q-3'])
    // The call's own input has no questions, so the card reads them from its details.
    expect(result.details?.questions).toEqual(questions)
  })

  test('if nobody answers that card, the queued question simply stays open — same id', async () => {
    const humanInLoop = createHumanInLoopController({ now: () => Date.now() + HITL_DECISION_MS })
    const touched: unknown[] = []
    const tool = createAskTool(
      port({
        recall: async () => ({ questions, openQuestionId: 'q-3' }),
        queue: async (input) => {
          touched.push(input)
          return { questionId: 'q-5', superseded: [] }
        },
        supersede: async (id) => void touched.push(id),
      }),
    )
    const result = await tool.execute('call_2', { from: 'q-3' }, undefined, undefined, {
      humanInLoop,
    })
    expect(result.isError).toBe(true)
    expect(touched).toEqual([])
    expect(result.content).toContain('q-3 stays open in the queue')
  })

  test('a Deny on that card is a decision: the queued question closes too', async () => {
    const humanInLoop = createHumanInLoopController()
    const superseded: string[] = []
    const tool = createAskTool(
      port({
        recall: async () => ({ questions, openQuestionId: 'q-3' }),
        supersede: async (id) => void superseded.push(id),
      }),
    )
    const pending = tool.execute('call_2', { from: 'q-3' }, undefined, undefined, { humanInLoop })
    for (let tick = 0; tick < 20 && humanInLoop.listPending().length === 0; tick++)
      await Promise.resolve()
    humanInLoop.reject('call_2', new HumanInLoopDismissedError('denied'))
    await pending.catch(() => undefined)
    expect(superseded).toEqual(['q-3'])
  })

  test('questions and from together are refused rather than guessed between', async () => {
    const result = await createAskTool(port()).execute('c', { questions, from: 'q-1' })
    expect(result).toMatchObject({ isError: true, content: 'Give questions or from, not both.' })
  })

  test('queuing what is still open queues nothing a second time', async () => {
    const queued: unknown[] = []
    const tool = createAskTool(
      port({
        recall: async () => ({ questions, openQuestionId: 'q-3' }),
        queue: async (input) => {
          queued.push(input)
          return { questionId: 'q-9', superseded: [] }
        },
      }),
    )
    const result = await tool.execute('call_2', { from: 'q-3', wait: false })
    expect(queued).toEqual([])
    expect(result.content).toContain('q-3 is still open')
    expect(result.details).toEqual({ questions, stillOpen: 'q-3' })
  })

  test('an expired blocking ask can be queued by its call id', async () => {
    const tool = createAskTool(port({ recall: async () => ({ questions }) }))
    const result = await tool.execute('call_7', { from: 'call_1', wait: false })
    expect(result.content).toContain('Queued as q-9')
    expect(result.details).toMatchObject({ questions, queued: { questionId: 'q-9' } })
  })

  test('an expired blocking ask tells the agent how to queue it by id', async () => {
    const humanInLoop = createHumanInLoopController({ now: () => Date.now() + HITL_DECISION_MS })
    const result = await createAskTool(port()).execute(
      'call_1',
      { questions },
      undefined,
      undefined,
      { humanInLoop },
    )
    expect(result.content).toContain('from: "call_1" and wait: false')
  })

  test('a refused recall, or neither questions nor from, is an error with the reason', async () => {
    const tool = createAskTool(port({ recall: async () => ({ refused: 'No earlier question' }) }))
    expect(await tool.execute('c', { from: 'q-7' })).toMatchObject({
      isError: true,
      content: 'No earlier question',
    })
    expect(await tool.execute('c', {})).toMatchObject({ isError: true })
  })
})
