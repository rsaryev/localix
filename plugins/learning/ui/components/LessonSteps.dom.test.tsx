import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { registerDom } from '@localixai/kit/testing'
import type { QuizStep } from '../../shared/contracts'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const step: QuizStep = {
  id: 'runtime-types',
  type: 'quiz',
  question: 'What does Bun do with TypeScript?',
  options: [
    { id: 'a', label: 'It replaces static type checking' },
    { id: 'b', label: 'It runs TypeScript while type checking stays separate' },
  ],
  correctOptionId: 'b',
  explanation: 'Runtime transpilation and static type checking are separate concerns.',
}

describe('Learning quiz recovery', () => {
  test('keeps the answer hidden after a mistake and exposes a clear retry action', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { LessonStepView } = await import('./LessonSteps')
    const host = document.createElement('div')
    const root = createRoot(host)
    const answers: boolean[] = []

    await act(async () => {
      root.render(
        <LessonStepView
          step={step}
          quizPosition={{ current: 2, total: 6 }}
          onAnswer={(_stepId, correct) => answers.push(correct)}
        />,
      )
    })

    const option = (label: string) =>
      Array.from(host.querySelectorAll('button')).find((button) =>
        button.textContent?.includes(label),
      )

    await act(async () => {
      option('replaces static type checking')?.click()
    })

    expect(host.textContent).toContain('Question 2 of 6')
    expect(host.textContent).toContain('Try another answer.')
    expect(host.textContent).toContain('Try again')
    expect(host.textContent).not.toContain(step.explanation)
    expect(option('runs TypeScript')?.className).not.toContain('text-status-success')
    expect(answers).toEqual([false])

    await act(async () => {
      option('Try again')?.click()
    })
    expect(option('replaces static type checking')?.disabled).toBe(false)

    await act(async () => {
      option('runs TypeScript')?.click()
    })
    expect(host.textContent).toContain(step.explanation)
    expect(host.textContent).not.toContain('Try again')
    expect(answers).toEqual([false, true])

    await act(async () => root.unmount())
  })
})
