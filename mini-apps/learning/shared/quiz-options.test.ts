import { expect, test } from 'bun:test'
import type { QuizStep } from './contracts'
import { quizOptions } from './quiz-options'

test('quiz ordering is stable, preserves ids and distributes correct answers across positions', () => {
  const positions = new Set<number>()
  const sample: QuizStep = {
    id: 'question-0',
    type: 'quiz',
    question: 'Which outcome follows?',
    options: [
      { id: 'correct', label: 'A' },
      { id: 'second', label: 'B' },
      { id: 'third', label: 'C' },
      { id: 'fourth', label: 'D' },
    ],
    correctOptionId: 'correct',
    explanation: 'Because of the model.',
  }
  for (let index = 0; index < 100; index++) {
    const step = { ...sample, id: `question-${index}` }
    const ordered = quizOptions(step)
    expect(ordered).toEqual(quizOptions(step))
    expect(ordered.map((option) => option.id).sort()).toEqual(
      step.options.map((option) => option.id).sort(),
    )
    positions.add(ordered.findIndex((option) => option.id === step.correctOptionId))
  }
  expect(positions.size).toBe(4)
  expect(sample.options[0]?.id).toBe('correct')
})
