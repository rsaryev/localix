import type { LearningCourse, LessonStep, StepEvidence } from '../shared/contracts'

/** Completion must prove an attempt; a client boolean must never grade a quiz. */
export function recordEvidence(
  course: LearningCourse,
  step: LessonStep,
  evidence?: StepEvidence,
): LearningCourse {
  const previous = course.assessments?.[step.id]
  if (course.completedStepIds.includes(step.id)) return course
  const now = new Date().toISOString()
  if (step.type === 'quiz') {
    if (!evidence?.optionId || !step.options.some((option) => option.id === evidence.optionId))
      throw new Error('Choose one of this question’s options')
    const correct = evidence.optionId === step.correctOptionId
    return {
      ...course,
      assessments: {
        ...course.assessments,
        [step.id]: {
          attempts: (previous?.attempts ?? 0) + 1,
          firstCorrect: previous?.firstCorrect ?? correct,
          selectedOptionId: evidence.optionId,
          correct,
          updatedAt: now,
        },
      },
    }
  }
  if (step.type === 'practice' && previous?.passed !== true)
    throw new Error('Submit your practice and receive a passing review first')
  if (step.type === 'flashcards' && evidence?.recalled !== true)
    throw new Error('Recall every card before continuing')
  return course
}
