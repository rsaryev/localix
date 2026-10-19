import { describe, expect, test } from 'bun:test'
import type { PersistedMessage } from '../contracts'
import {
  FLOOR_ADVICE_CONFIDENCE,
  FLOOR_PERSON,
  FLOOR_WINDOW,
  adviseHandoff,
  floorDecisionRequest,
  floorTranscript,
  readFloor,
  type FloorQuestion,
} from './floor-advice'

const members = [
  { agentId: 'builtin:localix', handle: 'localix', description: 'General assistant.' },
  { agentId: 'builtin:design', handle: 'design', description: 'The interface people use.' },
  { agentId: 'builtin:lawyer', handle: 'lawyer' },
]

const row = (payload: Record<string, unknown>): PersistedMessage => ({ payload }) as never
const person = (content: string) => row({ role: 'user', from: 'user', content })
const reply = (agentId: string, content: string) =>
  row({ role: 'assistant', from: `agent:${agentId}`, content })

const question = (overrides: Partial<FloorQuestion> = {}): FloorQuestion => ({
  members,
  history: [person('We need a checkout form.'), reply('builtin:localix', 'On it.')],
  text: 'Lawyer, check the consent wording.',
  authorAgentId: 'builtin:design',
  ...overrides,
})

describe('the transcript a decision model reads', () => {
  test('ends with the event, written by its author, after the visible rows', () => {
    expect(floorTranscript(question())).toEqual([
      { author: FLOOR_PERSON, text: 'We need a checkout form.' },
      { author: '@localix', text: 'On it.' },
      { author: '@design', text: 'Lawyer, check the consent wording.' },
    ])
  })

  test('skips what the person never read and keeps the last window', () => {
    const history = [
      row({ role: 'user', from: 'user', content: 'hidden wake', isInternal: true }),
      row({ role: 'assistant', from: 'agent:builtin:localix', content: 'note', uiOnly: true }),
      ...Array.from({ length: 20 }, (_, i) => person(`message ${i}`)),
    ]
    const transcript = floorTranscript(question({ history, authorAgentId: undefined }))
    expect(transcript).toHaveLength(FLOOR_WINDOW)
    expect(transcript.at(-2)).toEqual({ author: FLOOR_PERSON, text: 'message 19' })
    expect(transcript.some((entry) => /hidden|note/.test(entry.text))).toBe(false)
  })

  test('keeps the head and the tail of a long reply: the result and the handoff', () => {
    const text = `Result first. ${'x'.repeat(2000)} Over to @lawyer.`
    const [last] = floorTranscript(question({ history: [], text }))
    expect(last!.text.startsWith('Result first.')).toBe(true)
    expect(last!.text.endsWith('Over to @lawyer.')).toBe(true)
    expect(last!.text.length).toBeLessThan(520)
  })
})

describe('the decision request', () => {
  test('after a reply: every colleague but the author, and the person', () => {
    const request = floorDecisionRequest(question())
    expect(Object.keys(request.questions.next!.criteria)).toEqual(['localix', 'lawyer', 'person'])
    // An agent with no description is named for its handle rather than left blank.
    expect((request.questions.next!.criteria as Record<string, string>).lawyer).toBe(
      'The lawyer specialist.',
    )
  })

  test('after the person: the participants only — the floor cannot stay with the person', () => {
    const request = floorDecisionRequest(question({ authorAgentId: undefined }))
    expect(Object.keys(request.questions.next!.criteria)).toEqual(['localix', 'design', 'lawyer'])
  })
})

describe('the person’s untagged message asks two more questions', () => {
  test('one participant alone or the leader to coordinate, and whom — the leader among them', () => {
    const request = floorDecisionRequest(
      question({ authorAgentId: undefined, leaderAgentId: 'builtin:localix' }),
    )
    expect(Object.keys(request.questions)).toEqual(['next', 'alone', 'which'])
    expect(request.questions.alone).toMatchObject({ type: 'bool' })
    expect(request.questions.alone!.instructions).toContain('without @localix coordinating')
    expect(Object.keys((request.questions.which as { criteria: object }).criteria)).toEqual([
      'localix',
      'design',
      'lawyer',
    ])
  })

  test('a specialist who leads is named as the coordinator, never as a general assistant', () => {
    const request = floorDecisionRequest(
      question({ authorAgentId: undefined, leaderAgentId: 'builtin:design' }),
    )
    expect(request.questions.alone!.instructions).toContain('without @design coordinating')
    expect(JSON.stringify(request.questions.alone)).not.toContain('general assistant')
  })

  test('after a reply, or with no leader, only the one question', () => {
    expect(Object.keys(floorDecisionRequest(question()).questions)).toEqual(['next'])
    expect(
      Object.keys(floorDecisionRequest(question({ authorAgentId: undefined })).questions),
    ).toEqual(['next'])
  })
})

describe('reading the answer', () => {
  const reply = floorDecisionRequest(question())
  const message = floorDecisionRequest(
    question({ authorAgentId: undefined, leaderAgentId: 'builtin:localix' }),
  )
  const choice = (picked: string, probabilities: Record<string, number>) => ({
    type: 'choice' as const,
    choice: picked,
    probabilities,
  })
  const answered = (answers: Record<string, unknown>) => ({ answers }) as never

  test('a pick counts only at or above the confidence bar', () => {
    const at = (p: number) => answered({ next: choice('lawyer', { lawyer: p }) })
    expect(readFloor(at(FLOOR_ADVICE_CONFIDENCE), reply)).toMatchObject({
      pick: 'lawyer',
      reason: 'confident',
    })
    expect(readFloor(at(FLOOR_ADVICE_CONFIDENCE - 0.01), reply)).toMatchObject({
      pick: null,
      reason: 'unsure',
    })
  })

  test('a pick outside the options, or no answer, is no advice', () => {
    expect(readFloor(answered({ next: choice('design', { design: 0.99 }) }), reply).pick).toBeNull()
    expect(readFloor(answered({}), reply).pick).toBeNull()
  })

  // LOCALIX-92, "make the tiles the same size": the one question split between two participants.
  test('one participant alone, two close picks: the leading one takes it', () => {
    const reading = readFloor(
      answered({
        next: choice('design', { design: 0.58, lawyer: 0.41, localix: 0.01 }),
        alone: { type: 'bool', probability: 0.85 },
        which: choice('design', { design: 0.64, lawyer: 0.36 }),
      }),
      message,
    )
    expect(reading).toMatchObject({ pick: 'design', reason: 'alone', alone: 0.85 })
  })

  test('a clear “needs coordinating” keeps the message with the leader, even over a pick', () => {
    const reading = readFloor(
      answered({
        next: choice('lawyer', { lawyer: 0.9 }),
        alone: { type: 'bool', probability: 0.3 },
        which: choice('lawyer', { lawyer: 0.9 }),
      }),
      message,
    )
    expect(reading).toMatchObject({ pick: null, reason: 'coordinate' })
  })

  test('unsure on both counts leaves it with the leader', () => {
    const reading = readFloor(
      answered({
        next: choice('design', { design: 0.5 }),
        alone: { type: 'bool', probability: 0.5 },
        which: choice('design', { design: 0.9 }),
      }),
      message,
    )
    expect(reading).toMatchObject({ pick: null, reason: 'unsure' })
  })
})

describe('advice applied to a reply’s handoff plan', () => {
  const plan = { reports: ['localix'], assignments: ['design'] }

  test('no advice leaves the grammar’s plan', () => {
    expect(adviseHandoff(plan, null)).toBe(plan)
  })

  test('the person: the @s were references, but the report to whoever assigned stands', () => {
    expect(adviseHandoff(plan, FLOOR_PERSON)).toEqual({ reports: ['localix'], assignments: [] })
  })

  test('a colleague the plan already reaches keeps the plan', () => {
    expect(adviseHandoff(plan, 'design')).toBe(plan)
  })

  test('another colleague becomes the one asked to act', () => {
    expect(adviseHandoff(plan, 'lawyer')).toEqual({ reports: ['localix'], assignments: ['lawyer'] })
    expect(adviseHandoff({ reports: [], assignments: [] }, 'lawyer')).toEqual({
      reports: [],
      assignments: ['lawyer'],
    })
  })

  test('a report that is the reply’s only way on is never forked into a second turn', () => {
    const report = { reports: ['localix'], assignments: [] }
    expect(adviseHandoff(report, 'lawyer')).toBe(report)
  })
})
