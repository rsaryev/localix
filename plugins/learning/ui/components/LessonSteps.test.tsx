import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { LessonStep } from '../../shared/contracts'
import { LessonStepRail, LessonStepView } from './LessonSteps'

const steps: LessonStep[] = [
  {
    id: 'theory',
    type: 'concept',
    title: 'Core idea',
    body: 'Read **the explanation**.\n\n- First\n- Then use `bun test`.',
  },
  {
    id: 'test-runtime',
    type: 'quiz',
    question: 'What did you learn?',
    options: [
      { id: 'a', label: 'The idea' },
      { id: 'b', label: 'Only the wording' },
    ],
    correctOptionId: 'a',
    explanation: 'Apply the idea.',
  },
  {
    id: 'test-types',
    type: 'quiz',
    question: 'What still needs a separate check?',
    options: [
      { id: 'a', label: 'Runtime syntax' },
      { id: 'b', label: 'Static types' },
    ],
    correctOptionId: 'b',
    explanation: 'Run a type checker separately.',
  },
  {
    id: 'practice',
    type: 'practice',
    title: 'Use it',
    prompt: 'Solve a new task.',
    acceptanceCriteria: ['Explain the result'],
  },
]

test('shows the lesson trajectory while rendering only the active step', () => {
  const rail = renderToStaticMarkup(
    <LessonStepRail
      steps={steps}
      activeStepId="test-runtime"
      completedStepIds={new Set(['theory'])}
      unlockedStepIds={new Set(['theory', 'test-runtime'])}
      onSelect={() => {}}
    />,
  )
  const active = renderToStaticMarkup(
    <LessonStepView step={steps[1]!} quizPosition={{ current: 1, total: 2 }} onAnswer={() => {}} />,
  )

  expect(rail).toContain('Theory')
  expect(rail).toContain('Test 1 of 2')
  expect(rail).toContain('Test 2 of 2')
  expect(rail).toContain('Practice')
  expect(rail).toContain('aria-label="Completed"')
  expect(rail).toContain('aria-label="Locked"')
  expect(rail).toContain('disabled=""')
  expect(active).toContain('What did you learn?')
  expect(active).toContain('Question 1 of 2')
  expect(active).not.toContain('Read the explanation.')
  expect(active).not.toContain('Solve a new task.')
  expect(rail).not.toContain('draggable=')
})

test('renders lesson Markdown as structured preview instead of raw source', () => {
  const theory = renderToStaticMarkup(<LessonStepView step={steps[0]!} onAnswer={() => {}} />)

  expect(theory).toContain('<strong>the explanation</strong>')
  expect(theory).toContain('<ul>')
  expect(theory).toContain('<code>bun test</code>')
  expect(theory).not.toContain('**the explanation**')
})

test('does not repeat a standalone Markdown heading that matches the theory title', () => {
  const theory = renderToStaticMarkup(
    <LessonStepView
      step={{
        id: 'trace-first',
        type: 'concept',
        title: 'Trace-first observability',
        body: '# Trace-first observability\n\nStart with the complete execution trace.',
      }}
      onAnswer={() => {}}
    />,
  )

  expect(theory.match(/Trace-first observability/g)).toHaveLength(1)
  expect(theory).toContain('Start with the complete execution trace.')
})
