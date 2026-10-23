import { expect, test } from 'bun:test'
import { z } from 'zod'
import type { MiniAppContext } from '@localixai/mini-app-sdk/backend'
import type { LearningCourse } from '../shared/contracts'
import { LEARNING_CHANGES_CHANNEL, LEARNING_MINI_APP } from '../shared/course-changes'
import type { LearningService } from './service'
import type { LearningTutor } from './tutor'
import { createLearningCourseTool } from './tool'

const course = {
  id: 'course',
  title: 'Course',
  modules: [
    {
      id: 'module',
      lessons: [{ id: 'lesson', title: 'Lesson', steps: [{ id: 'step' }] }],
    },
  ],
  progress: {},
} as unknown as LearningCourse

function harness() {
  const commands: Array<[string, string, unknown]> = []
  const ctx = {
    z,
    userId: 'user',
    cwd: '/work',
    defineTool: (definition: unknown) => definition,
    ui: { offer: (target: unknown) => target },
  } as unknown as MiniAppContext
  const service = {
    get: async () => course,
    setActive: async () => course,
  } as unknown as LearningService
  const tutor = { review: async () => course } as unknown as LearningTutor
  const tool = createLearningCourseTool(ctx, service, tutor) as unknown as {
    execute: (
      id: string,
      input: unknown,
      signal?: AbortSignal,
      u?: unknown,
      c?: unknown,
    ) => Promise<{ isError?: boolean }>
  }
  const context = {
    session: {
      id: 'chat-1',
      emitCommand: (miniApp: string, channel: string, payload: unknown) =>
        commands.push([miniApp, channel, payload]),
    },
  }
  const run = (input: unknown) => tool.execute('call', input, undefined, undefined, context)
  return { run, commands }
}

/**
 * The open course and library re-read every 5 s, in a background window too, to catch what the
 * agent's tool changed. The tool now says so: once per change, after it landed, and never for a
 * read — a read that announced would make every reader re-read on every lookup.
 */
test('a change through the tool is announced to the UI; a read is not', async () => {
  const { run, commands } = harness()
  expect((await run({ action: 'get', course_id: 'course' })).isError).toBeFalsy()
  expect(commands).toEqual([])

  expect((await run({ action: 'open', course_id: 'course', lesson_id: 'lesson' })).isError).toBe(
    undefined,
  )
  expect(commands).toEqual([[LEARNING_MINI_APP, LEARNING_CHANGES_CHANNEL, { courseId: 'course' }]])

  await run({
    action: 'review',
    course_id: 'course',
    step_id: 'step',
    submission_id: '00000000-0000-4000-8000-000000000000',
    passed: true,
    feedback: 'Good.',
  })
  expect(commands).toHaveLength(2)
})

test('a failed change announces nothing', async () => {
  const { run, commands } = harness()
  expect((await run({ action: 'open', course_id: 'course', lesson_id: 'missing' })).isError).toBe(
    true,
  )
  expect(commands).toEqual([])
})
