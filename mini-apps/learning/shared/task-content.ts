import type { LessonStep } from './contracts'

/** Both saved evidence and in-progress controls belong to the assessed task, not just its id. */
export function taskContent(step: LessonStep): string {
  return JSON.stringify(
    step.type === 'quiz'
      ? {
          type: step.type,
          question: step.question,
          options: step.options,
          correctOptionId: step.correctOptionId,
        }
      : step.type === 'practice'
        ? { type: step.type, prompt: step.prompt, acceptanceCriteria: step.acceptanceCriteria }
        : step.type === 'flashcards'
          ? { type: step.type, cards: step.cards }
          : { type: step.type },
  )
}
