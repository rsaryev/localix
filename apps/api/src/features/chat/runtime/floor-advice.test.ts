import { describe, expect, test } from 'bun:test'
import type { PersistedMessage } from '../contracts'
import {
  FLOOR_ADVICE_CONFIDENCE,
  FLOOR_PERSON,
  FLOOR_WINDOW,
  adviseHandoff,
  confidentFloor,
  floorDecisionRequest,
  floorTranscript,
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
    expect(request.questions.next!.criteria.lawyer).toBe('The lawyer specialist.')
  })

  test('after the person: the participants only — the floor cannot stay with the person', () => {
    const request = floorDecisionRequest(question({ authorAgentId: undefined }))
    expect(Object.keys(request.questions.next!.criteria)).toEqual(['localix', 'design', 'lawyer'])
  })
})

describe('reading the answer', () => {
  const request = floorDecisionRequest(question())
  const answer = (choice: string, probability: number) => ({
    answers: { next: { choice, probabilities: { [choice]: probability } } },
  })

  test('a pick counts only at or above the confidence bar', () => {
    expect(confidentFloor(answer('lawyer', FLOOR_ADVICE_CONFIDENCE), request)).toBe('lawyer')
    expect(confidentFloor(answer('lawyer', FLOOR_ADVICE_CONFIDENCE - 0.01), request)).toBeNull()
  })

  test('a pick outside the options, or no answer, is no advice', () => {
    expect(confidentFloor(answer('design', 0.99), request)).toBeNull()
    expect(confidentFloor({ answers: {} }, request)).toBeNull()
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
