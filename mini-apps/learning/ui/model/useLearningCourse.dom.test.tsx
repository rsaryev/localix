import { afterAll, afterEach, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import { miniAppRealtime } from '@localixai/mini-app-sdk/ui/runtime'
import { learningApi, LearningApiError } from '../api/learningApi'
import type { LearningCourse } from '../../shared/contracts'
import { useLearningCourse } from './useLearningCourse'

let teardown: () => Promise<void>
let restoreRealtime: () => void
const actEnvironment = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
beforeAll(() => {
  teardown = registerDom()
  // These tests drive invalidation and polling; no host websocket should be opened.
  const realtime = [
    spyOn(miniAppRealtime, 'onFrame').mockReturnValue(() => {}),
    spyOn(miniAppRealtime, 'onReconnect').mockReturnValue(() => {}),
    spyOn(miniAppRealtime, 'onDisconnect').mockReturnValue(() => {}),
    spyOn(miniAppRealtime, 'request').mockResolvedValue(undefined),
  ]
  restoreRealtime = () => realtime.forEach((method) => method.mockRestore())
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
})
afterAll(async () => {
  restoreRealtime()
  await teardown()
  if (actEnvironment) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', actEnvironment)
  else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
})
const restores: Array<() => void> = []
afterEach(() => {
  for (const restore of restores.splice(0)) restore()
})

const course: LearningCourse = {
  version: 4,
  id: 'course',
  sessionId: 'S',
  bundlePath: 'course.json',
  title: 'Course',
  topic: 'Loops',
  goal: 'Trace loops',
  description: 'Practice loops',
  level: 'beginner',
  language: 'English',
  estimatedMinutes: 20,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  progress: {},
  activeLessonId: 'lesson',
  activeStepId: 'question',
  completedStepIds: [],
  modules: [
    {
      id: 'module',
      title: 'Module',
      description: 'One module',
      lessons: [
        {
          id: 'lesson',
          title: 'Lesson',
          summary: 'One lesson',
          estimatedMinutes: 20,
          generationStatus: 'ready',
          objectives: [],
          steps: [
            {
              id: 'question',
              type: 'quiz',
              question: 'Which?',
              options: [
                { id: 'a', label: 'A' },
                { id: 'b', label: 'B' },
              ],
              correctOptionId: 'a',
              explanation: 'A',
            },
          ],
        },
      ],
    },
  ],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function harness() {
  const { act, useEffect } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  const root = createRoot(host)
  let current!: ReturnType<typeof useLearningCourse>
  let poll = () => {}
  const timer = spyOn(window, 'setInterval').mockImplementation(((callback: () => void) => {
    poll = callback
    return 1
  }) as typeof window.setInterval)
  const clear = spyOn(window, 'clearInterval').mockImplementation(() => {})
  restores.push(() => {
    timer.mockRestore()
    clear.mockRestore()
  })
  function Probe({ sessionId }: { sessionId: string }) {
    const value = useLearningCourse(sessionId, 'course', true)
    useEffect(() => {
      current = value
    })
    return null
  }
  const render = async (sessionId = 'S') => {
    await act(async () => root.render(<Probe sessionId={sessionId} />))
  }
  await render()
  return {
    act,
    render,
    poll: () => poll(),
    current: () => current,
    unmount: async () => {
      await act(async () => root.unmount())
    },
  }
}

test('a poll started before an answer cannot overwrite the saved evidence', async () => {
  const late = deferred<LearningCourse | null>()
  const get = spyOn(learningApi, 'get')
    .mockResolvedValueOnce(course)
    .mockReturnValueOnce(late.promise)
  const saved = { ...course, completedStepIds: ['question'] }
  const write = spyOn(learningApi, 'completeStep').mockResolvedValue(saved)
  restores.push(() => {
    get.mockRestore()
    write.mockRestore()
  })
  const view = await harness()
  try {
    await view.act(async () => {
      view.poll()
    })
    await view.act(async () => {
      await view.current().submitAnswer('question', { optionId: 'a' })
    })
    await view.act(async () => {
      late.resolve(course)
      await late.promise
    })
    expect(view.current().course?.completedStepIds).toEqual(['question'])
    expect(view.current().busy).toBe(false)
  } finally {
    await view.unmount()
  }
})

test('successful polling preserves a failed submission until retry instead of flashing the problem line', async () => {
  const get = spyOn(learningApi, 'get').mockResolvedValue(course)
  const write = spyOn(learningApi, 'completeStep').mockRejectedValue(
    new LearningApiError('Please retry', 'HTTP 404'),
  )
  restores.push(() => {
    get.mockRestore()
    write.mockRestore()
  })
  const view = await harness()
  try {
    await view.act(async () => {
      await view
        .current()
        .submitAnswer('question', { optionId: 'a' })
        .catch(() => {})
    })
    await view.act(async () => {
      view.poll()
    })
    expect(view.current().failure?.message).toBe('Please retry')
    expect(view.current().failureIsWrite).toBe(true)
    expect(view.current().course).toEqual(course)
    write.mockResolvedValue(course)
    await view.act(async () => {
      await view.current().submitAnswer('question', { optionId: 'a' })
    })
    expect(view.current().failure).toBeNull()
  } finally {
    await view.unmount()
  }
})

test('changing sessions during a save loads the new course and ignores the old response', async () => {
  const late = deferred<LearningCourse>()
  const next = { ...course, sessionId: 'OTHER', title: 'Other course' }
  const get = spyOn(learningApi, 'get').mockResolvedValueOnce(course).mockResolvedValueOnce(next)
  const write = spyOn(learningApi, 'completeStep').mockReturnValue(late.promise)
  restores.push(() => {
    get.mockRestore()
    write.mockRestore()
  })
  const view = await harness()
  try {
    let saving!: Promise<void>
    await view.act(async () => {
      saving = view.current().submitAnswer('question', { optionId: 'a' })
    })
    expect(view.current().busy).toBe(true)
    await view.render('OTHER')
    expect(view.current().busy).toBe(false)
    expect(view.current().course?.sessionId).toBe('OTHER')
    await view.act(async () => {
      late.resolve(course)
      await saving
    })
    expect(view.current().course?.sessionId).toBe('OTHER')
  } finally {
    await view.unmount()
  }
})
