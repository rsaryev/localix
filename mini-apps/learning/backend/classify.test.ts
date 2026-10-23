import { expect, test } from 'bun:test'
import type { CallClass } from '@localixai/mini-app-sdk/backend'
import { classifyLearningCourseCall } from './tool'

const rows: Array<[string, unknown, CallClass]> = [
  ['guide', { action: 'guide' }, { effect: 'read' }],
  ['list', { action: 'list' }, { effect: 'read' }],
  ['get', { action: 'get', course_id: 'c1' }, { effect: 'read' }],
  ['validate', { action: 'validate', manifest_path: 'course.json' }, { effect: 'read' }],
  ['draft', { action: 'draft', outline_path: 'outline.json' }, { effect: 'files' }],
  ['activate', { action: 'activate', manifest_path: 'course.json' }, { effect: 'session' }],
  ['open', { action: 'open', course_id: 'c1' }, { effect: 'session' }],
  ['review', { action: 'review', course_id: 'c1', step_id: 's1' }, { effect: 'session' }],
  ['unknown action', { action: 'publish' }, { effect: 'external' }],
  ['no action', {}, { effect: 'external' }],
]

test.each(rows)('learning_course %s', (_label, input, expected) => {
  expect(classifyLearningCourseCall(input)).toEqual(expected)
})
