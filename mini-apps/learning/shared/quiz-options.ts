import type { QuizStep } from './contracts'

/** Stable ids keep saved answers valid while display order avoids positional hints. */
export function quizOptions(step: QuizStep): QuizStep['options'] {
  let seed = 2166136261
  for (const char of `${step.id}:${step.question}`) {
    seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0
  }
  const options = [...step.options]
  for (let index = options.length - 1; index > 0; index--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const target = Math.floor((seed / 4294967296) * (index + 1))
    const previous = options[index]!
    options[index] = options[target]!
    options[target] = previous
  }
  return options
}
