import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CourseBundleValidationError,
  formatCourseBundleError,
  loadCourseBundle,
  type CourseBundleDiagnostic,
} from './course-bundle'

test('structured diagnostics preserve their identity, cause and repair text', () => {
  const diagnostic: CourseBundleDiagnostic = {
    code: 'invalid-manifest',
    file: 'lesson.json',
    field: 'estimatedMinutes',
    message: 'Invalid duration.',
    fix: 'Set a positive duration.',
  }
  const cause = new Error('Original failure')
  const error = new CourseBundleValidationError(diagnostic, { cause })
  expect(error.diagnostic).toBe(diagnostic)
  expect(error.cause).toBe(cause)
  expect(error.name).toBe('CourseBundleValidationError')
  expect(formatCourseBundleError(error)).toBe(
    [
      'Course validation failed.',
      'Code: invalid-manifest',
      'File: lesson.json',
      'Field: estimatedMinutes',
      'Issue: Invalid duration.',
      'Fix: Set a positive duration.',
      'Retry: patch this file and call learning_course activate with the same root course.json.',
    ].join('\n'),
  )
})

test('a missing course manifest throws the historically exported class with its original cause', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'learning-bundle-error-'))
  try {
    const missing = join(dir, 'course.json')
    let caught: unknown
    try {
      await loadCourseBundle(missing, [dir])
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(CourseBundleValidationError)
    const error = caught as CourseBundleValidationError
    expect(error.diagnostic).toMatchObject({ code: 'invalid-root', file: missing })
    expect(error.cause).toBeInstanceOf(Error)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
