import { describe, expect, test } from 'bun:test'
import { createHumanInLoopController } from '@localixai/agent/agents'
import { classifyAsk, createAskTool, normalizeAskAnswers, type AskToolResponse } from './ask'
import type { AskQueuePort } from './ask-queue'
import { HITL_DECISION_MS } from './decision-deadline'

describe('createAskTool', () => {
  test('waits for a human response and returns normalized answers', () => {
    const humanInLoop = createHumanInLoopController()
    const tool = createAskTool()
    const updates: unknown[] = []

    const resultPromise = tool.execute(
      'call_1',
      {
        loading_messages: ['Waiting for your decision...'],
        questions: [
          {
            id: 'direction',
            question: 'Which direction should we take?',
            options: [{ label: 'Fast' }, { label: 'Careful', value: 'careful' }],
            recommended: 1,
          },
        ],
      },
      undefined,
      (details) => updates.push(details),
      { humanInLoop },
    )

    const [pending] = humanInLoop.listPending()
    expect(pending?.request.id).toBe('call_1')
    expect(pending?.request.kind).toBe('ask')
    expect(updates).toHaveLength(1)

    const response: AskToolResponse = {
      requestId: 'call_1',
      kind: 'ask',
      payload: {
        answers: [
          {
            id: 'direction',
            question: 'Which direction should we take?',
            selectedOptions: ['careful', 'unknown'],
          },
        ],
      },
      respondedAt: Date.now(),
    }
    expect(humanInLoop.respond(response)).toBe(true)

    expect(resultPromise).resolves.toMatchObject({
      content: 'User answers:\ndirection: careful',
      details: {
        answers: [
          {
            id: 'direction',
            question: 'Which direction should we take?',
            selectedOptions: ['careful'],
          },
        ],
      },
    })
    expect(humanInLoop.listPending()).toHaveLength(0)
  })

  test('returns an error when no human-in-loop controller is configured', () => {
    const tool = createAskTool()

    expect(
      tool.execute('call_1', {
        loading_messages: ['Waiting for confirmation...'],
        questions: [
          {
            id: 'q',
            question: 'Continue?',
            options: [{ label: 'Yes' }],
          },
        ],
      }),
    ).resolves.toMatchObject({
      isError: true,
    })
  })

  /**
   * This tool used to ANSWER ITSELF after 180 seconds, picking the `recommended` option so
   * the run could continue. The run continuing was never the problem; the lie was. The
   * transcript recorded a choice nobody made, and "the user picked Careful" could equally
   * mean the user was in another room.
   */
  test('an unanswered question is refused, never auto-answered', async () => {
    // The controller's own expiry: a clock already past the deadline rejects at request time.
    const humanInLoop = createHumanInLoopController({ now: () => Date.now() + HITL_DECISION_MS })
    const result = await createAskTool().execute(
      'call_1',
      {
        loading_messages: ['…'],
        questions: [
          {
            id: 'direction',
            question: 'Which direction?',
            options: [{ label: 'Fast' }, { label: 'Careful' }],
            recommended: 1,
          },
        ],
      },
      undefined,
      undefined,
      { humanInLoop },
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('AUTO-DENIED')
    // The recommended option is nowhere in the result: nothing was chosen on anyone's behalf.
    expect(result.content).not.toContain('Careful')
    expect(humanInLoop.listPending()).toHaveLength(0)
  })
})

describe('ask classification', () => {
  test.each([
    ['blocking by default', { questions: [] }, { effect: 'read', needsHuman: true }],
    ['blocking explicitly', { wait: true }, { effect: 'read', needsHuman: true }],
    ['queued for later', { wait: false }, { effect: 'session', needsHuman: true }],
    ['a non-boolean wait', { wait: 'false' }, { effect: 'external', needsHuman: true }],
    // Not an object: the schema refuses it, so the class is the widest, never a guess.
    ['no input object', null, { effect: 'external', needsHuman: true }],
  ] as const)('%s', (_label, input, expected) => {
    expect(classifyAsk(input)).toEqual(expected)
    expect(createAskTool().classify?.(input)).toEqual(expected)
  })
})

describe('ask in a run nobody watches', () => {
  const blocking = {
    questions: [{ id: 'q', question: 'Continue?', options: [{ label: 'Yes' }] }],
  }

  test('a blocking question is refused before any card is raised', async () => {
    const humanInLoop = createHumanInLoopController()
    const result = await createAskTool().execute('call_1', blocking, undefined, undefined, {
      humanInLoop,
      interactive: false,
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('No one can answer')
    expect(humanInLoop.listPending()).toHaveLength(0)
  })

  test('with a queue, the refusal points at wait: false', async () => {
    const queue = { queue: async () => ({ questionId: 'q-1' }) } as unknown as AskQueuePort
    const result = await createAskTool(queue).execute('call_1', blocking, undefined, undefined, {
      humanInLoop: createHumanInLoopController(),
      interactive: false,
    })
    expect(result.content).toContain('wait: false')
  })

  test('an absent `interactive` flag still raises the card', async () => {
    const humanInLoop = createHumanInLoopController()
    void createAskTool().execute('call_2', blocking, undefined, undefined, { humanInLoop })
    await Promise.resolve()
    expect(humanInLoop.listPending()).toHaveLength(1)
  })
})

describe('normalizeAskAnswers', () => {
  test('keeps only offered values, one unless multi, and drops answers to unasked questions', () => {
    const answers = normalizeAskAnswers(
      {
        questions: [
          { id: 'db', question: 'DB?', options: [{ label: 'Postgres' }, { label: 'SQLite' }] },
        ],
      },
      [
        { id: 'db', question: 'DB?', selectedOptions: ['Postgres', 'SQLite', 'Oracle'] },
        { id: 'ghost', question: 'never asked', selectedOptions: ['x'] },
      ],
    )
    expect(answers).toEqual([{ id: 'db', question: 'DB?', selectedOptions: ['Postgres'] }])
  })
})
