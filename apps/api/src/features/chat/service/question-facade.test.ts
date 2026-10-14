import { describe, expect, test } from 'bun:test'

import type { QuestionRecord } from '../../questions/contracts'
import type { QuestionRegistry } from '../../questions/registry'
import { createChatQuestionFacade, type ChatQuestionFacadeDeps } from './question-facade'

const NOW = '2026-10-02T12:00:00.000Z'

const record = (overrides: Partial<QuestionRecord> = {}): QuestionRecord => ({
  id: 'row-1',
  userId: 'u1',
  sessionId: 's1',
  agentId: 'lead',
  displayId: 'q-1',
  toolCallId: 'call-ask',
  questions: [{ id: 'db', question: 'Which database?', options: [{ label: 'Postgres' }] }],
  status: 'answered',
  answers: [{ id: 'db', question: 'Which database?', selectedOptions: ['Postgres'] }],
  askedAt: NOW,
  resolvedAt: NOW,
  ...overrides,
})

function harness(
  opts: {
    live?: boolean
    open?: QuestionRecord[]
    stranded?: QuestionRecord[]
    /** Whether the `ask` call is still on the active branch. */
    onBranch?: boolean
  } = {},
) {
  const wakes: unknown[] = []
  const superseded: string[] = []
  const livePatches: unknown[] = []
  const updates: { messageId: string; patch: unknown }[] = []
  const published: unknown[] = []
  const answered: unknown[] = []
  const message = {
    id: 'm1',
    sessionId: 's1',
    userId: 'u1',
    createdAt: NOW,
    updatedAt: NOW,
    payload: {
      id: 'm1',
      role: 'assistant',
      items: [
        {
          id: 'item-ask',
          type: 'tool_call',
          toolCallId: 'call-ask',
          name: 'ask',
          status: 'completed',
          activeVerb: 'Awaiting user input',
          output: { queued: { questionId: 'q-1', status: 'pending' } },
        },
      ],
    },
  }
  const questions = {
    list: () => opts.open ?? [],
    answer: async (...args: unknown[]) => {
      answered.push(args)
      return (opts.open ?? []).length > 0
        ? { ok: true, record: record() }
        : { ok: false, reason: 'not_found' }
    },
    skip: async () => ({ ok: false, reason: 'already_resolved' }),
    supersede: async (_owner: unknown, id: string) => {
      superseded.push(id)
      return { ok: true, record: record() }
    },
    undeliveredAnswers: async () => opts.stranded ?? [],
  } as unknown as QuestionRegistry
  const deps = {
    repo: {
      findActiveBranchToolCallMessage: async () => (opts.onBranch === false ? null : message),
      updateMessage: async (_u: string, _s: string, messageId: string, patch: unknown) => {
        updates.push({ messageId, patch })
        return null
      },
    },
    runner: {
      patchLiveToolItem: (_id: string, patch: unknown) => {
        livePatches.push(patch)
        return opts.live === true
      },
    },
    streamRegistry: { publish: (...args: unknown[]) => published.push(args) },
    now: () => NOW,
    questions,
    requireSession: async () => ({}),
    wakes: { send: (...args: unknown[]) => wakes.push(args) },
  } as unknown as ChatQuestionFacadeDeps
  return {
    facade: createChatQuestionFacade(deps),
    wakes,
    superseded,
    livePatches,
    updates,
    published,
    answered,
  }
}

describe('settling a closed question', () => {
  test('an answer wakes the participant that asked — once ever, by its receipt', async () => {
    const h = harness()
    await h.facade.settleQuestion(record())
    expect(h.wakes).toHaveLength(1)
    const [request] = h.wakes[0] as [Record<string, unknown>]
    expect(request).toMatchObject({
      sessionId: 's1',
      source: 'answer',
      to: { participant: 'agent:lead' },
      deliveryKey: 'question:row-1',
      // The receipt is what marks it delivered — what the recovery sweep reads.
      receipt: true,
    })
    expect(request.content).toContain('[Answer to q-1]')
    expect(request.content).toContain('Postgres')
  })

  test('a skip or a supersede costs no turn — a skip is told in the next prompt', async () => {
    const h = harness()
    await h.facade.settleQuestion(record({ status: 'skipped', answers: null }))
    await h.facade.settleQuestion(record({ status: 'superseded', answers: null }))
    expect(h.wakes).toHaveLength(0)
  })

  test('the recovery sweep re-sends every answer that has no receipt, with the same key', async () => {
    const h = harness({ stranded: [record({ id: 'row-7', displayId: 'q-7' })] })
    expect(await h.facade.redeliverAnswers()).toBe(1)
    expect((h.wakes[0] as unknown[])[0]).toMatchObject({
      deliveryKey: 'question:row-7',
      receipt: true,
    })
  })

  test('while the asking run still writes the card, the card is patched THROUGH it', async () => {
    // A stored-row write here would be overwritten by that run's next flush.
    const h = harness({ live: true })
    await h.facade.settleQuestion(record())
    expect(h.livePatches).toMatchObject([
      {
        details: {
          queued: { questionId: 'q-1', status: 'answered' },
          answers: [{ id: 'db', selectedOptions: ['Postgres'] }],
        },
      },
    ])
    expect(h.updates).toHaveLength(0)
  })

  test('once no run holds the card, the stored row is patched and published', async () => {
    const h = harness({ live: false })
    await h.facade.settleQuestion(record({ status: 'skipped', answers: null }))
    expect(h.updates).toHaveLength(1)
    const items = (h.updates[0]!.patch as { items: Array<{ output: unknown }> }).items
    expect(items[0]!.output).toEqual({
      // The questions ride along: a card that recalled its question by `from` has no input copy.
      questions: record().questions,
      queued: { questionId: 'q-1', status: 'skipped', answeredAt: NOW },
    })
    expect(h.published).toHaveLength(1)
  })
})

describe('after the active branch moved', () => {
  const open = (overrides: Partial<QuestionRecord>) =>
    record({ status: 'pending', answers: null, resolvedAt: null, ...overrides })

  test('a question whose ask is no longer on the branch is closed, without a wake', async () => {
    const h = harness({ open: [open({ askedAt: '2026-10-02T11:00:00.000Z' })], onBranch: false })
    await h.facade.reconcileQuestions('u1', 's1', NOW)
    expect(h.superseded).toEqual(['q-1'])
    expect(h.wakes).toHaveLength(0)
  })

  test('one still on the branch, or asked after the move began, is left open', async () => {
    const before = harness({ open: [open({ askedAt: '2026-10-02T11:00:00.000Z' })] })
    await before.facade.reconcileQuestions('u1', 's1', NOW)
    expect(before.superseded).toEqual([])
    // Asked by the run the move itself started: its call may not be on disk yet.
    const after = harness({
      open: [open({ askedAt: '2026-10-02T12:00:01.000Z' })],
      onBranch: false,
    })
    await after.facade.reconcileQuestions('u1', 's1', NOW)
    expect(after.superseded).toEqual([])
  })
})

describe('the person answering', () => {
  test('the answer goes to the registry by owner and id, as submitted', async () => {
    const h = harness({ open: [record({ status: 'pending', answers: null, resolvedAt: null })] })
    const submitted = [{ id: 'db', question: 'Which database?', selectedOptions: ['Postgres'] }]
    await h.facade.answerQuestion('u1', 's1', 'q-1', submitted)
    expect(h.answered).toEqual([[{ userId: 'u1', sessionId: 's1' }, 'q-1', submitted]])
  })

  test('a question that is not open is a 404, one another tab closed is a 409', async () => {
    const h = harness({ open: [] })
    await expect(h.facade.answerQuestion('u1', 's1', 'q-9', [])).rejects.toMatchObject({
      status: 404,
    })
    await expect(h.facade.skipQuestion('u1', 's1', 'q-1')).rejects.toMatchObject({ status: 409 })
  })
})
