import { describe, expect, test } from 'bun:test'

import type { LearningCourse } from '../../shared/contracts'
import { activeLesson, activeStep, courseLessons, nextLesson, stepStage } from './course'

const course: LearningCourse = {
  version: 4,
  id: 'course',
  sessionId: 'session-1',
  bundlePath: '/data/courses/course/course.json',
  title: 'Systems thinking',
  topic: 'Systems',
  goal: 'Model feedback loops',
  description: 'A compact course',
  level: 'beginner',
  language: 'English',
  estimatedMinutes: 40,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  activeLessonId: 'lesson-b',
  activeStepId: 'test-b',
  completedStepIds: ['theory-b'],
  progress: {},
  modules: [
    {
      id: 'module-a',
      title: 'Foundations',
      description: 'Core ideas',
      lessons: [
        {
          id: 'lesson-a',
          title: 'Stocks',
          summary: 'What accumulates',
          estimatedMinutes: 20,
          generationStatus: 'pending',
          objectives: [],
          steps: [],
        },
        {
          id: 'lesson-b',
          title: 'Flows',
          summary: 'What changes stocks',
          estimatedMinutes: 20,
          generationStatus: 'ready',
          objectives: [{ id: 'objective-b', text: 'Identify a flow' }],
          steps: [
            { id: 'theory-b', type: 'concept', title: 'Flow', body: 'A rate.' },
            {
              id: 'test-b',
              type: 'quiz',
              question: 'What is a flow?',
              options: [
                { id: 'a', label: 'A rate' },
                { id: 'b', label: 'A stock' },
              ],
              correctOptionId: 'a',
              explanation: 'A flow is a rate.',
            },
            {
              id: 'practice-b',
              type: 'practice',
              title: 'Apply',
              prompt: 'Name a flow.',
              acceptanceCriteria: ['Name one'],
            },
          ],
        },
      ],
    },
  ],
}

describe('learning course model', () => {
  test('flattens modules and resolves the active lesson and step', () => {
    expect(courseLessons(course).map((entry) => entry.lesson.id)).toEqual(['lesson-a', 'lesson-b'])
    expect(activeLesson(course)?.lesson.id).toBe('lesson-b')
    expect(activeStep(course, course.modules[0]!.lessons[1]!)?.id).toBe('test-b')
    expect(nextLesson(course, 'lesson-a')?.lesson.id).toBe('lesson-b')
    expect(stepStage(course.modules[0]!.lessons[1]!.steps[1]!)).toBe('test')
  })
})
