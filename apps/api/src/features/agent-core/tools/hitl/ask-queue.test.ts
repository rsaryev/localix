import { describe, expect, test } from 'bun:test'

import { buildOpenQuestionsSection, queuedAnswerText, queuedSkipText } from './ask-queue'

const questions = [
  {
    id: 'db',
    question: 'Which database?',
    options: [{ label: 'Postgres', value: 'pg' }, { label: 'SQLite' }],
  },
  { id: 'style', question: 'Code style?', options: [{ label: 'Terse' }] },
]

describe('queuedAnswerText', () => {
  test('names the question, and says what the person chose in the words they saw', () => {
    const text = queuedAnswerText('q-3', questions, [
      { id: 'db', question: 'Which database?', selectedOptions: ['pg'] },
      { id: 'style', question: 'Code style?', selectedOptions: [], customInput: 'match the repo' },
    ])
    expect(text).toStartWith('[Answer to q-3]')
    // The option's LABEL, not its machine value — the model reads what the person read.
    expect(text).toContain('- db (Which database?): Postgres')
    expect(text).toContain('- style (Code style?): "match the repo"')
  })

  test('a question left blank says so rather than vanishing', () => {
    const text = queuedAnswerText('q-3', questions, [
      { id: 'db', question: 'Which database?', selectedOptions: ['SQLite'] },
    ])
    expect(text).toContain('- style (Code style?): (no answer)')
  })
})

describe('queuedSkipText', () => {
  test('tells the agent not to re-ask and to state its assumption', () => {
    const text = queuedSkipText('q-2', 'Which database?')
    expect(text).toContain('q-2')
    expect(text).toContain('Do not ask it again')
  })
})

describe('buildOpenQuestionsSection', () => {
  const now = Date.parse('2026-10-02T12:10:00.000Z')

  test('nothing open renders nothing', () => {
    expect(buildOpenQuestionsSection([], now)).toBeNull()
  })

  test('a skip is said here once, even with nothing left open', () => {
    const text = buildOpenQuestionsSection([], now, [
      { questionId: 'q-2', question: 'Which database?' },
    ])!
    expect(text).toStartWith('# Open questions')
    expect(text).toContain('skipped your queued question q-2')
    expect(text).not.toContain('still unanswered')
  })

  test('lists each open question with its age and the rule not to re-ask', () => {
    const text = buildOpenQuestionsSection(
      [
        {
          questionId: 'q-1',
          question: 'Which database?',
          count: 2,
          askedAt: Date.parse('2026-10-02T12:05:00.000Z'),
        },
      ],
      now,
    )!
    expect(text).toStartWith('# Open questions')
    expect(text).toContain('- q-1 · asked 5m ago · Which database? (+1 more)')
    expect(text).toContain('Do not ask them again')
  })
})
