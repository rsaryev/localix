import { describe, expect, test } from 'bun:test'
import { createHumanInLoopController, HumanInLoopDismissedError } from '@localixai/agent/agents'
import {
  askToolInputSchema,
  classifyAsk,
  createAskTool,
  normalizeAskAnswers,
  prepareAskArguments,
  NO_WATCHER_TEXT,
  SKIPPED_ASK_TEXT,
  UNANSWERED_ASK_TEXT,
  type AskToolResponse,
} from './ask'
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
      content: 'User answers:\ndirection: careful\nContinue the task with these answers.',
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
  test('an unanswered question closes after the deadline, never auto-answered', async () => {
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
    // Not an error: the person was away. The model is told to go on with its best assumption.
    expect(result.isError).toBeUndefined()
    expect(result.content).toBe(UNANSWERED_ASK_TEXT)
    expect(result.content).toContain('did not answer within 5 minutes')
    expect(result.content).not.toContain('AUTO-DENIED')
    expect(result.details).toMatchObject({ expired: true })
    // The recommended option is nowhere in the result: nothing was chosen on anyone's behalf.
    expect(result.content).not.toContain('Careful')
    expect(humanInLoop.listPending()).toHaveLength(0)
  })
})

describe('skipping a question', () => {
  test('Skip tells the agent the person skipped it — not an error, not a denial', async () => {
    const humanInLoop = createHumanInLoopController()
    const pending = createAskTool().execute(
      'call_skip',
      { questions: [{ id: 'scope', question: 'Which scope?', options: [{ label: 'All' }] }] },
      undefined,
      undefined,
      { humanInLoop },
    )
    await Promise.resolve()
    expect(humanInLoop.reject('call_skip', new HumanInLoopDismissedError())).toBe(true)
    const result = await pending
    expect(result.isError).toBeUndefined()
    expect(result.content).toBe(SKIPPED_ASK_TEXT)
    expect(result.content).toContain('skipped this question')
    expect(result.details).toMatchObject({ skipped: true })
  })
})

describe('ask classification', () => {
  test('every ask is a read that needs a human', () => {
    for (const input of [{ questions: [] }, null]) {
      expect(classifyAsk(input)).toEqual({ effect: 'read', needsHuman: true })
      expect(createAskTool().classify?.(input)).toEqual({ effect: 'read', needsHuman: true })
    }
  })

  test('the schema no longer accepts wait or from', () => {
    const questions = [{ id: 'q', question: 'Q', options: [{ label: 'x' }] }]
    expect(askToolInputSchema.safeParse({ questions }).success).toBe(true)
    expect(askToolInputSchema.safeParse({ from: 'q-1' }).success).toBe(false)
    expect(askToolInputSchema.keyof().options).not.toContain('wait')
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
    expect(result.content).toBe(NO_WATCHER_TEXT)
    expect(humanInLoop.listPending()).toHaveLength(0)
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

describe('prepareAskArguments', () => {
  test('LOCALIX-189: one question written at the top level is wrapped in questions', () => {
    const options = [{ label: 'Yes' }, { label: 'No' }]
    const prepared = prepareAskArguments({
      id: 'mode',
      question: 'Continue?',
      options,
      recommended: 0,
    })
    expect(prepared).toEqual({
      questions: [{ id: 'mode', question: 'Continue?', options, recommended: 0 }],
    })
    expect(askToolInputSchema.safeParse(prepared).success).toBe(true)
  })

  test('the canonical shape and a bare loading message', () => {
    const canonical = { questions: [{ id: 'a', question: 'Q', options: [{ label: 'x' }] }] }
    expect(prepareAskArguments(canonical)).toBe(canonical)
    expect(prepareAskArguments({ ...canonical, loading_messages: 'Thinking' })).toEqual({
      ...canonical,
      loading_messages: ['Thinking'],
    })
  })
})

describe('AskUserQuestion as Claude Code calls it', () => {
  test('header names the answer and multiSelect lets several be chosen', () => {
    const input = askToolInputSchema.parse(
      prepareAskArguments({
        questions: [
          {
            question: 'Which approach?',
            header: 'Approach',
            options: [{ label: 'Fast', description: 'Ship today' }, { label: 'Careful' }],
            multiSelect: true,
          },
        ],
      }),
    )
    expect(input.questions[0]).toMatchObject({ id: 'Approach', multi: true })
    expect(input.questions[0]!.options[0]).toMatchObject({
      label: 'Fast',
      description: 'Ship today',
    })
  })
})
