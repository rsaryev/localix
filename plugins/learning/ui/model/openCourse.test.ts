import { expect, test } from 'bun:test'
import '@localixai/kit/testing/host-runtime'

import { registerInspectorHandler, type InspectorRequest } from '@localixai/kit/testing'
import { learningCourseTabId, openLearningCourse, openLearningLibrary } from './openCourse'

test('opens the course library in the current session scope', () => {
  const opened: InspectorRequest[] = []
  const unregister = registerInspectorHandler((request) => opened.push(request))
  try {
    openLearningLibrary('LOCALIX-42')
  } finally {
    unregister()
  }

  expect(opened).toMatchObject([
    {
      kind: 'work-item',
      workKind: 'learning:workspace',
      id: 'learning:workspace',
      title: 'Learning Studio',
      scope: 'LOCALIX-42',
    },
  ])
})

test('opens independent stable tabs for different courses, each in the chat that owns it', () => {
  const opened: InspectorRequest[] = []
  const unregister = registerInspectorHandler((request) => opened.push(request))
  try {
    openLearningCourse('OTHER', 'course-a', 'Course A')
    openLearningCourse('OWNER', 'course-b', 'Course B')
  } finally {
    unregister()
  }

  expect(learningCourseTabId('course-a')).toBe('learning:course:course-a')
  expect(opened).toMatchObject([
    {
      kind: 'work-item',
      workKind: 'learning:course',
      id: 'learning:course:course-a',
      scope: 'OTHER',
    },
    {
      kind: 'work-item',
      workKind: 'learning:course',
      id: 'learning:course:course-b',
      scope: 'OWNER',
    },
  ])
})
