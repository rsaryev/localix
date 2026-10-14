import { describe, expect, it } from 'bun:test'

import {
  learningCourseUri,
  learningLessonUri,
  learningModuleUri,
  learningStepUri,
  parseLearningResourceUri,
} from './resource-uri'

describe('learning resource URI', () => {
  it('round-trips the complete course hierarchy', () => {
    expect(parseLearningResourceUri(learningCourseUri('session/a'))).toEqual({
      kind: 'course',
      courseId: 'session/a',
    })
    expect(parseLearningResourceUri(learningModuleUri('session/a', 'module 1'))).toEqual({
      kind: 'module',
      courseId: 'session/a',
      moduleId: 'module 1',
    })
    expect(
      parseLearningResourceUri(learningLessonUri('session/a', 'module 1', 'lesson:1')),
    ).toEqual({
      kind: 'lesson',
      courseId: 'session/a',
      moduleId: 'module 1',
      lessonId: 'lesson:1',
    })
    expect(
      parseLearningResourceUri(learningStepUri('session/a', 'module 1', 'lesson:1', 'practice/1')),
    ).toEqual({
      kind: 'step',
      courseId: 'session/a',
      moduleId: 'module 1',
      lessonId: 'lesson:1',
      stepId: 'practice/1',
    })
  })

  it('rejects other providers and malformed hierarchy', () => {
    expect(parseLearningResourceUri('localix://resource/db/course')).toBeNull()
    expect(parseLearningResourceUri('localix://resource/learning/session/lesson')).toBeNull()
  })
})
