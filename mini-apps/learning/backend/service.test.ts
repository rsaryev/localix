import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { learningCourseUri } from '../shared/resource-uri'
import { formatCourseBundleError, loadCourseBundle } from './course-bundle'
import { createLearningResourceProvider } from './resource-provider'
import { LearningService } from './service'
import { createLearningRoutes } from './routes'
import { LearningTutor } from './tutor'
import { createCourseDraft } from './course-draft'
import { ModuleGenerator, moduleToWarm } from './module-generation'
import { register } from './index'
import { z } from 'zod'
import type { MiniAppContext, MiniAppWakeRequest } from '@localixai/mini-app-sdk/backend'

const roots: string[] = []

async function root(): Promise<string> {
  const value = await mkdtemp(path.join(os.tmpdir(), 'localix-learning-'))
  roots.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })))
})

test('learning routes resolve user identity per request through MiniAppRouteContext', async () => {
  const storage = await root()
  const seen: string[] = []
  const service = new LearningService(async (userId, sessionId) => {
    seen.push(userId)
    return path.join(storage, userId, sessionId)
  })
  const routes = createLearningRoutes(service)

  expect(
    (
      await routes.request(
        '/courses?sessionId=session-a',
        {},
        { userId: 'user-a', projectId: '', cwd: storage },
      )
    ).status,
  ).toBe(200)
  expect(
    (
      await routes.request(
        '/courses?sessionId=session-b',
        {},
        { userId: 'user-b', projectId: '', cwd: storage },
      )
    ).status,
  ).toBe(200)
  expect(seen).toEqual(['user-a', 'user-b'])
})

test('a tool-time registration uses sessionStorage without requiring a backend host singleton', async () => {
  const storage = await root()
  const seen: string[] = []
  const ctx = {
    z,
    userId: 'user-a',
    cwd: storage,
    defineTool: (definition: unknown) => definition,
    sessionStorage: {
      resolveDataDir: async (userId: string, sessionId: string) => {
        seen.push(`${userId}:${sessionId}`)
        return path.join(storage, sessionId)
      },
    },
  } as unknown as MiniAppContext
  const backends = register(ctx).backend!
  const routes = (Array.isArray(backends) ? backends[0]! : backends).routeMount!.app
  const result = await routes.request(
    '/courses?sessionId=TOOL',
    {},
    { userId: 'user-a', projectId: '', cwd: storage },
  )
  expect(result.status).toBe(200)
  expect(seen).toEqual(['user-a:TOOL'])
})

async function json(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 2))
}

async function completeLearningStep(
  service: LearningService,
  userId: string,
  sessionId: string,
  courseId: string,
  lessonId: string,
  stepId: string,
) {
  if (stepId === 'apply-loop') {
    const tutor = new LearningTutor(service, async () => ({ status: 'delivered' }))
    const submitted = await tutor.submit(
      userId,
      sessionId,
      courseId,
      lessonId,
      stepId,
      'The thermostat measures temperature and adjusts heating; the resulting temperature is measured again.',
    )
    await tutor.review(
      userId,
      sessionId,
      courseId,
      stepId,
      submitted!.assessments![stepId]!.submissionId!,
      true,
      'Both the cause and returning effect are present.',
    )
  }
  return service.completeStep(userId, sessionId, courseId, lessonId, stepId, { optionId: 'a' })
}

async function courseBundle(base: string, courseId = 'systems-thinking'): Promise<string> {
  const course = path.join(base, courseId)
  const moduleDir = path.join(course, 'modules', 'foundations')
  const lessonDir = path.join(moduleDir, 'lessons', 'feedback-loop')
  const theoryDir = path.join(lessonDir, 'steps', 'core-idea')
  const testDir = path.join(lessonDir, 'steps', 'retrieval-check')
  const practiceDir = path.join(lessonDir, 'steps', 'apply-loop')
  await json(path.join(course, 'course.json'), {
    schemaVersion: 1,
    id: courseId,
    title: 'Systems thinking',
    topic: 'Feedback loops',
    goal: 'Model a feedback loop',
    description: 'A file-authored course',
    level: 'beginner',
    language: 'English',
    estimatedMinutes: 30,
    modules: ['modules/foundations/module.json'],
  })
  await json(path.join(moduleDir, 'module.json'), {
    id: 'foundations',
    title: 'Foundations',
    description: 'Core mental models',
    lessons: ['lessons/feedback-loop/lesson.json'],
  })
  await json(path.join(lessonDir, 'lesson.json'), {
    id: 'feedback-loop',
    title: 'Feedback loops',
    summary: 'Trace one complete loop.',
    estimatedMinutes: 30,
    generationStatus: 'ready',
    objectives: [{ id: 'trace-loop', text: 'Trace a loop' }],
    steps: [
      'steps/core-idea/step.json',
      'steps/retrieval-check/step.json',
      'steps/apply-loop/step.json',
    ],
  })
  await json(path.join(theoryDir, 'step.json'), {
    id: 'core-idea',
    type: 'concept',
    title: 'The central idea',
    content: 'content.md',
  })
  await mkdir(theoryDir, { recursive: true })
  await writeFile(
    path.join(theoryDir, 'content.md'),
    '# Feedback\n\nA loop returns the effect to its cause.',
  )
  await json(path.join(testDir, 'step.json'), {
    id: 'retrieval-check',
    type: 'quiz',
    question: 'What closes a feedback loop?',
    options: [
      { id: 'a', label: 'The effect returns to the cause' },
      { id: 'b', label: 'A list ends' },
    ],
    correctOptionId: 'a',
    explanation: 'explanation.md',
  })
  await writeFile(path.join(testDir, 'explanation.md'), 'The output influences the next input.')
  await json(path.join(practiceDir, 'step.json'), {
    id: 'apply-loop',
    type: 'practice',
    title: 'Trace a fresh loop',
    prompt: 'prompt.md',
    acceptanceCriteria: ['Name the cause', 'Show the returning effect'],
  })
  await writeFile(path.join(practiceDir, 'prompt.md'), 'Trace a thermostat feedback loop.')
  return path.join(course, 'course.json')
}

describe('file-authored Learning courses', () => {
  test('loads the physical course/module/lesson/step hierarchy and Markdown theory', async () => {
    const workspace = await root()
    const manifest = await courseBundle(path.join(workspace, '.localix', 'learning-drafts'))
    const loaded = await loadCourseBundle(manifest, [workspace])

    expect(loaded.id).toBe('systems-thinking')
    expect(loaded.modules[0]?.lessons[0]?.steps[0]).toMatchObject({
      id: 'core-idea',
      type: 'concept',
      body: '# Feedback\n\nA loop returns the effect to its cause.',
    })
    expect(loaded.filePaths.map((file) => path.relative(loaded.rootDir, file))).toContain(
      'modules/foundations/lessons/feedback-loop/steps/core-idea/content.md',
    )
  })

  test('rejects more than ten quiz steps in one lesson', async () => {
    const workspace = await root()
    const manifest = await courseBundle(path.join(workspace, '.localix', 'learning-drafts'))
    const lessonDir = path.join(path.dirname(manifest), 'modules/foundations/lessons/feedback-loop')
    const quizRefs = ['steps/retrieval-check/step.json']
    for (let index = 2; index <= 11; index += 1) {
      const relative = `steps/retrieval-check-${index}/step.json`
      const directory = path.join(lessonDir, path.dirname(relative))
      quizRefs.push(relative)
      await json(path.join(lessonDir, relative), {
        id: `retrieval-check-${index}`,
        type: 'quiz',
        question: `Diagnostic question ${index}?`,
        options: [
          { id: 'a', label: 'First option' },
          { id: 'b', label: 'Second option' },
        ],
        correctOptionId: 'a',
        explanation: 'explanation.md',
      })
      await writeFile(path.join(directory, 'explanation.md'), `Explanation ${index}.`)
    }
    const lessonPath = path.join(lessonDir, 'lesson.json')
    const lesson = JSON.parse(await readFile(lessonPath, 'utf8')) as Record<string, unknown>
    await json(lessonPath, {
      ...lesson,
      steps: ['steps/core-idea/step.json', ...quizRefs, 'steps/apply-loop/step.json'],
    })

    expect(loadCourseBundle(manifest, [workspace])).rejects.toThrow('limit is 10')
  })

  test('imports two independent courses from one session and preserves both', async () => {
    const workspace = await root()
    const dataDir = path.join(await root(), 'data')
    const service = new LearningService(async () => dataDir)
    for (const courseId of ['systems-thinking', 'agent-runtime']) {
      const manifest = await courseBundle(
        path.join(workspace, '.localix', 'learning-drafts'),
        courseId,
      )
      const source = await loadCourseBundle(manifest, [workspace])
      await service.activateBundle('user-a', 'LOCALIX-900', source)
    }

    expect(await service.list('user-a', 'LOCALIX-900')).toMatchObject([
      { id: 'agent-runtime', sessionId: 'LOCALIX-900' },
      { id: 'systems-thinking', sessionId: 'LOCALIX-900' },
    ])
    expect((await service.get('user-a', 'LOCALIX-900', 'systems-thinking'))?.bundlePath).toContain(
      'systems-thinking/course.json',
    )
  })

  test('exports a shareable course without progress or unrelated files and imports it safely', async () => {
    const workspace = await root()
    const storage = await root()
    const service = new LearningService(async (_userId, sessionId) => path.join(storage, sessionId))
    const manifest = await courseBundle(path.join(workspace, '.localix', 'learning-drafts'))
    await writeFile(path.join(path.dirname(manifest), 'private-notes.txt'), 'do not share')
    await service.activateBundle('user-a', 'SOURCE', await loadCourseBundle(manifest, [workspace]))
    await service.completeStep('user-a', 'SOURCE', 'systems-thinking', 'feedback-loop', 'core-idea')

    const serialized = await service.exportPortable('user-a', 'SOURCE', 'systems-thinking')
    expect(serialized).not.toBeNull()
    const portable = JSON.parse(serialized!) as {
      format: string
      files: Array<{ path: string; content: string }>
    }
    expect(portable.format).toBe('localix-learning-course')
    expect(portable.files.some((file) => file.path === '.learning-state.json')).toBe(false)
    expect(portable.files.some((file) => file.path === 'private-notes.txt')).toBe(false)

    const imported = await service.importPortable('user-a', 'TARGET', serialized!)
    expect(imported.id).toBe('systems-thinking')
    expect(imported.completedStepIds).toEqual([])
    expect(await service.list('user-a', 'TARGET')).toMatchObject([{ id: 'systems-thinking' }])
    expect(service.importPortable('user-a', 'TARGET', serialized!)).rejects.toThrow(
      'already exists',
    )
  })

  test('reports the exact bad file and accepts a targeted repair without rebuilding the course', async () => {
    const workspace = await root()
    const manifest = await courseBundle(path.join(workspace, '.localix', 'learning-drafts'))
    const theory = path.join(
      path.dirname(manifest),
      'modules/foundations/lessons/feedback-loop/steps/core-idea/content.md',
    )
    await rm(theory)
    expect(loadCourseBundle(manifest, [workspace])).rejects.toThrow('content.md')
    await writeFile(theory, 'Repaired theory.')
    expect(
      (await loadCourseBundle(manifest, [workspace])).modules[0]?.lessons[0]?.steps[0],
    ).toMatchObject({ body: 'Repaired theory.' })
  })

  test('reports both declarations for a duplicate id so the agent can patch one file', async () => {
    const workspace = await root()
    const manifest = await courseBundle(path.join(workspace, '.localix', 'learning-drafts'))
    const duplicate = path.join(
      path.dirname(manifest),
      'modules/foundations/lessons/feedback-loop/steps/core-idea/step.json',
    )
    await json(duplicate, {
      id: 'feedback-loop',
      type: 'concept',
      title: 'The central idea',
      content: 'content.md',
    })

    let message = ''
    try {
      await loadCourseBundle(manifest, [workspace])
    } catch (error) {
      message = formatCourseBundleError(error)
    }

    expect(message).toContain('Code: duplicate-id')
    expect(message).toContain(`File: ${await realpath(duplicate)}`)
    expect(message).toContain('lesson.json (id)')
    expect(message).toContain('patch this file')
  })

  test('re-activates a patched bundle while preserving progress for stable ids', async () => {
    const workspace = await root()
    const dataDir = path.join(await root(), 'data')
    const service = new LearningService(async () => dataDir)
    const manifest = await courseBundle(path.join(workspace, '.localix', 'learning-drafts'))
    const activate = async () => {
      const source = await loadCourseBundle(manifest, [workspace])
      return service.activateBundle('user-a', 'LOCALIX-900', source)
    }
    await activate()
    for (const stepId of ['core-idea', 'retrieval-check', 'apply-loop']) {
      await completeLearningStep(
        service,
        'user-a',
        'LOCALIX-900',
        'systems-thinking',
        'feedback-loop',
        stepId,
      )
    }
    await service.updateProgress('user-a', 'LOCALIX-900', 'systems-thinking', {
      lessonId: 'feedback-loop',
      status: 'completed',
    })
    const theory = path.join(
      path.dirname(manifest),
      'modules/foundations/lessons/feedback-loop/steps/core-idea/content.md',
    )
    await writeFile(theory, 'A deeper repaired explanation.')
    const reactivated = await activate()

    expect(reactivated.modules[0]?.lessons[0]?.steps[0]).toMatchObject({
      body: 'A deeper repaired explanation.',
    })
    expect(reactivated.progress['feedback-loop']?.status).toBe('completed')
    expect(reactivated.completedStepIds).toEqual(['core-idea', 'retrieval-check', 'apply-loop'])
  })

  test('treats repeated course completion as an idempotent transition', async () => {
    const workspace = await root()
    const dataDir = path.join(await root(), 'data')
    const service = new LearningService(async () => dataDir)
    const manifest = await courseBundle(path.join(workspace, '.localix', 'learning-drafts'))
    await service.activateBundle(
      'user-a',
      'LOCALIX-900',
      await loadCourseBundle(manifest, [workspace]),
    )
    for (const stepId of ['core-idea', 'retrieval-check', 'apply-loop']) {
      await completeLearningStep(
        service,
        'user-a',
        'LOCALIX-900',
        'systems-thinking',
        'feedback-loop',
        stepId,
      )
    }
    const first = await service.updateProgress('user-a', 'LOCALIX-900', 'systems-thinking', {
      lessonId: 'feedback-loop',
      status: 'completed',
      score: 100,
    })
    const repeated = await service.updateProgress('user-a', 'LOCALIX-900', 'systems-thinking', {
      lessonId: 'feedback-loop',
      status: 'completed',
      score: 100,
    })

    expect(first?.progress['feedback-loop']?.attempts).toBe(1)
    expect(repeated?.progress['feedback-loop']).toEqual(first?.progress['feedback-loop'])
  })

  test('resources are visible only inside the owning session', async () => {
    const workspace = await root()
    const storage = await root()
    const service = new LearningService(async (_userId, sessionId) => path.join(storage, sessionId))
    const manifest = await courseBundle(path.join(workspace, '.localix', 'learning-drafts'))
    const source = await loadCourseBundle(manifest, [workspace])
    await service.activateBundle('user-a', 'LOCALIX-900', source)
    const provider = createLearningResourceProvider(service)

    expect(await provider.listChildren('user-a', null, undefined, { sessionId: 'OTHER' })).toEqual(
      [],
    )
    expect(
      await provider.listChildren('user-a', null, undefined, {
        sessionId: 'LOCALIX-900',
      }),
    ).toMatchObject([{ uri: learningCourseUri('systems-thinking'), label: 'Systems thinking' }])
    expect(
      await provider.expand('user-a', learningCourseUri('systems-thinking'), {
        sessionId: 'OTHER',
      }),
    ).toMatchObject({ ok: false })
    expect(
      await provider.expand('user-a', learningCourseUri('systems-thinking'), {
        sessionId: 'LOCALIX-900',
      }),
    ).toMatchObject({ ok: true })
  })
})

describe('course activation and progress are safe', () => {
  test('activation copies the bundle files, never what sits beside course.json', async () => {
    // A course.json at a workspace root used to copy that whole directory — `.git`, `.env` and
    // all — into session data.
    const workspace = await root()
    const storage = await root()
    const service = new LearningService(async (_userId, sessionId) => path.join(storage, sessionId))
    const manifest = await courseBundle(path.join(workspace, '.localix', 'learning-drafts'))
    const courseDir = path.dirname(manifest)
    await writeFile(path.join(courseDir, '.env'), 'SECRET=1')
    await mkdir(path.join(courseDir, '.git'), { recursive: true })
    await writeFile(path.join(courseDir, '.git', 'HEAD'), 'ref: refs/heads/main')
    const course = await service.activateBundle(
      'user-a',
      'S',
      await loadCourseBundle(manifest, [workspace]),
    )
    const installed = path.dirname(course.bundlePath)
    expect(Bun.file(path.join(installed, '.env')).exists()).resolves.toBe(false)
    expect(Bun.file(path.join(installed, '.git', 'HEAD')).exists()).resolves.toBe(false)
    expect(course.modules[0]?.lessons[0]?.steps[0]).toMatchObject({ id: 'core-idea' })
  })

  test('the root manifest must be named course.json, not merely end with it', async () => {
    const workspace = await root()
    const manifest = await courseBundle(path.join(workspace, '.localix', 'learning-drafts'))
    const renamed = path.join(path.dirname(manifest), 'mycourse.json')
    await writeFile(renamed, await readFile(manifest, 'utf8'))
    expect(loadCourseBundle(renamed, [workspace])).rejects.toThrow('must be course.json')
  })

  test('overlapping progress writes do not drop each other', async () => {
    // Unordered read → modify → write: a setActive that read before a completion landed wrote
    // its stale `completedStepIds` back and erased the completed step.
    const workspace = await root()
    const storage = await root()
    const service = new LearningService(async (_userId, sessionId) => path.join(storage, sessionId))
    const manifest = await courseBundle(path.join(workspace, '.localix', 'learning-drafts'))
    await service.activateBundle('user-a', 'S', await loadCourseBundle(manifest, [workspace]))
    await service.completeStep('user-a', 'S', 'systems-thinking', 'feedback-loop', 'core-idea')
    await Promise.all([
      service.completeStep('user-a', 'S', 'systems-thinking', 'feedback-loop', 'retrieval-check', {
        optionId: 'a',
      }),
      service.setActive('user-a', 'S', 'systems-thinking', 'feedback-loop', 'core-idea'),
    ])
    const course = await service.get('user-a', 'S', 'systems-thinking')
    expect(course?.completedStepIds).toEqual(['core-idea', 'retrieval-check'])
  })
})

async function activatedCourse() {
  const workspace = await root()
  const storage = await root()
  const resolve = async (_userId: string, sessionId: string) => path.join(storage, sessionId)
  const service = new LearningService(resolve)
  const manifest = await courseBundle(workspace)
  const course = await service.activateBundle(
    'user-a',
    'S',
    await loadCourseBundle(manifest, [workspace]),
  )
  return { workspace, manifest, course, service, resolve }
}

describe('learner evidence and common tutor wake', () => {
  test('grades option ids on the server and retains the first attempt across retries and reloads', async () => {
    const { service, resolve } = await activatedCourse()
    await service.completeStep('user-a', 'S', 'systems-thinking', 'feedback-loop', 'core-idea')
    await expect(
      service.completeStep('user-a', 'S', 'systems-thinking', 'feedback-loop', 'retrieval-check'),
    ).rejects.toThrow('Choose')
    const wrong = await service.completeStep(
      'user-a',
      'S',
      'systems-thinking',
      'feedback-loop',
      'retrieval-check',
      { optionId: 'b' },
    )
    expect(wrong?.completedStepIds).not.toContain('retrieval-check')
    await expect(
      service.completeStep('user-a', 'S', 'systems-thinking', 'feedback-loop', 'apply-loop'),
    ).rejects.toThrow('previous step')
    await service.completeStep(
      'user-a',
      'S',
      'systems-thinking',
      'feedback-loop',
      'retrieval-check',
      { optionId: 'a' },
    )
    await completeLearningStep(
      service,
      'user-a',
      'S',
      'systems-thinking',
      'feedback-loop',
      'apply-loop',
    )
    const completed = await service.updateProgress('user-a', 'S', 'systems-thinking', {
      lessonId: 'feedback-loop',
      status: 'completed',
      score: 100,
    })
    expect(completed?.progress['feedback-loop']?.score).toBe(0)
    const reloaded = await new LearningService(resolve).get('user-a', 'S', 'systems-thinking')
    expect(reloaded?.assessments?.['retrieval-check']).toMatchObject({
      attempts: 2,
      firstCorrect: false,
      correct: true,
      selectedOptionId: 'a',
    })
  })

  test('practice HTTP route saves the solution and wakes its owning session through the host port', async () => {
    const { service, resolve, workspace } = await activatedCourse()
    await service.completeStep('user-a', 'S', 'systems-thinking', 'feedback-loop', 'core-idea')
    await service.completeStep(
      'user-a',
      'S',
      'systems-thinking',
      'feedback-loop',
      'retrieval-check',
      { optionId: 'a' },
    )
    await expect(
      service.completeStep('user-a', 'S', 'systems-thinking', 'feedback-loop', 'apply-loop'),
    ).rejects.toThrow('passing review')
    const wakes: MiniAppWakeRequest[] = []
    const tutor = new LearningTutor(service, async (request) => {
      wakes.push(request)
      return { status: 'delivered' }
    })
    const routes = createLearningRoutes(service, tutor)
    const result = await routes.request(
      '/course/practice',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'S',
          courseId: 'systems-thinking',
          lessonId: 'feedback-loop',
          stepId: 'apply-loop',
          response: 'Heat changes the temperature, which changes the heater command.',
        }),
      },
      { userId: 'user-a', projectId: '', cwd: workspace },
    )
    expect(result.status).toBe(200)
    const { course } = await result.json()
    const attempt = course.assessments['apply-loop']
    expect(attempt).toMatchObject({ attempts: 1, status: 'submitted' })
    expect(wakes).toHaveLength(1)
    expect(wakes[0]).toMatchObject({
      userId: 'user-a',
      sessionId: 'S',
      tools: ['learning_course'],
      key: `review:${attempt.submissionId}`,
    })
    expect(wakes[0]!.message).toContain('against every acceptance criterion')
    const review = new LearningTutor(new LearningService(resolve))
    await expect(
      review.review('user-a', 'S', course.id, 'apply-loop', 'outdated-id', true, 'Pass'),
    ).rejects.toThrow('stale')
    await review.review(
      'user-a',
      'S',
      course.id,
      'apply-loop',
      attempt.submissionId,
      false,
      'Name the measured quantity explicitly.',
    )
    await expect(
      service.completeStep('user-a', 'S', course.id, 'feedback-loop', 'apply-loop'),
    ).rejects.toThrow('passing review')
    const revision = await tutor.submit(
      'user-a',
      'S',
      course.id,
      'feedback-loop',
      'apply-loop',
      'The measured temperature changes the heater command, whose heat changes that temperature.',
    )
    const revised = revision!.assessments!['apply-loop']!
    expect(revised.attempts).toBe(2)
    await expect(
      review.review('user-a', 'S', course.id, 'apply-loop', attempt.submissionId, true, 'Pass'),
    ).rejects.toThrow('stale')
    await review.review(
      'user-a',
      'S',
      course.id,
      'apply-loop',
      revised.submissionId!,
      true,
      'Both criteria are supported by the loop you described.',
    )
    expect(
      (await service.completeStep('user-a', 'S', course.id, 'feedback-loop', 'apply-loop'))
        ?.completedStepIds,
    ).toContain('apply-loop')
    expect(wakes).toHaveLength(2)
    expect(await service.get('user-a', 'OTHER', course.id)).toBeNull()
  })

  test('a missed wake retains the draft solution and permits a new submission', async () => {
    const { service } = await activatedCourse()
    await service.completeStep('user-a', 'S', 'systems-thinking', 'feedback-loop', 'core-idea')
    await service.completeStep(
      'user-a',
      'S',
      'systems-thinking',
      'feedback-loop',
      'retrieval-check',
      { optionId: 'a' },
    )
    const tutor = new LearningTutor(service, async () => ({
      status: 'missed',
      reason: 'Session unavailable',
    }))
    const failed = await tutor.submit(
      'user-a',
      'S',
      'systems-thinking',
      'feedback-loop',
      'apply-loop',
      'My saved solution',
    )
    expect(failed?.assessments?.['apply-loop']).toMatchObject({
      response: 'My saved solution',
      status: 'unreachable',
    })
    const retry = await tutor.submit(
      'user-a',
      'S',
      'systems-thinking',
      'feedback-loop',
      'apply-loop',
      'My saved solution',
    )
    expect(retry?.assessments?.['apply-loop']?.attempts).toBe(2)
    expect(retry?.assessments?.['apply-loop']?.submissionId).not.toBe(
      failed?.assessments?.['apply-loop']?.submissionId,
    )
  })

  test('changing a graded question invalidates its evidence while preserving theory progress', async () => {
    const { service, course, workspace } = await activatedCourse()
    await service.completeStep('user-a', 'S', course.id, 'feedback-loop', 'core-idea')
    await service.completeStep('user-a', 'S', course.id, 'feedback-loop', 'retrieval-check', {
      optionId: 'a',
    })
    const quiz = path.join(
      path.dirname(course.bundlePath),
      'modules/foundations/lessons/feedback-loop/steps/retrieval-check/step.json',
    )
    const previous = JSON.parse(await readFile(quiz, 'utf8'))
    await json(quiz, { ...previous, question: 'Which measurement closes this particular loop?' })
    const reactivated = await service.activateBundle(
      'user-a',
      'S',
      await loadCourseBundle(course.bundlePath, [workspace, path.dirname(course.bundlePath)]),
    )
    expect(reactivated.completedStepIds).toEqual(['core-idea'])
    expect(reactivated.assessments?.['retrieval-check']).toBeUndefined()
  })
})

test('module prewarming claims one durable request across parallel service instances and retries failures with a bound', async () => {
  const { service, resolve, course } = await activatedCourse()
  const base = path.dirname(course.bundlePath)
  const manifest = JSON.parse(await readFile(course.bundlePath, 'utf8'))
  await json(course.bundlePath, {
    ...manifest,
    modules: [...manifest.modules, 'modules/transfer/module.json'],
  })
  await json(path.join(base, 'modules/transfer/module.json'), {
    id: 'transfer',
    title: 'Transfer',
    description: 'Apply to fresh systems',
    lessons: ['lessons/fresh/lesson.json'],
  })
  await json(path.join(base, 'modules/transfer/lessons/fresh/lesson.json'), {
    id: 'fresh',
    title: 'A fresh loop',
    summary: 'Transfer what you learned',
    estimatedMinutes: 20,
    generationStatus: 'pending',
    objectives: [],
    steps: [],
  })
  let now = Date.now()
  let wakes = 0
  const wake = async () => {
    wakes++
    return { status: 'failed' as const, reason: 'Unavailable' }
  }
  const first = new ModuleGenerator(service, wake, () => now)
  const second = new ModuleGenerator(new LearningService(resolve), wake, () => now)
  await Promise.all([first.warm('user-a', 'S', course.id), second.warm('user-a', 'S', course.id)])
  expect(wakes).toBe(1)
  expect((await service.get('user-a', 'S', course.id))?.generation?.transfer).toMatchObject({
    status: 'failed',
    attempts: 1,
  })
  await first.warm('user-a', 'S', course.id)
  expect(wakes).toBe(1)
  for (let index = 0; index < 5; index++) {
    now += 61_000
    await first.warm('user-a', 'S', course.id)
  }
  expect(wakes).toBe(3)
})

test('module warm-up starts while there is still material and targets the current module when it is pending', async () => {
  const { course } = await activatedCourse()
  const first = course.modules[0]!
  const lesson = first.lessons[0]!
  const expanded = {
    ...course,
    activeLessonId: 'one',
    modules: [
      { ...first, lessons: ['one', 'two', 'three', 'four'].map((id) => ({ ...lesson, id })) },
      {
        id: 'next',
        title: 'Next',
        description: 'Transfer',
        lessons: [{ ...lesson, id: 'five', generationStatus: 'pending' as const, steps: [] }],
      },
    ],
  }
  expect(moduleToWarm(expanded)).toBeNull()
  expanded.progress.one = { status: 'completed', attempts: 1, updatedAt: course.updatedAt }
  expect(moduleToWarm(expanded)).toBeNull()
  expanded.progress.two = { status: 'completed', attempts: 1, updatedAt: course.updatedAt }
  expect(moduleToWarm(expanded)).toBe('next')
  expanded.activeLessonId = 'four'
  expanded.progress = {}
  expect(moduleToWarm(expanded)).toBe('next')
  expanded.activeLessonId = 'five'
  expect(moduleToWarm(expanded)).toBe('next')
})

test('compact course drafts validate, preserve existing files and reject outlines outside the workspace', async () => {
  const workspace = await root()
  const plan = path.join(workspace, 'outline.json')
  await json(plan, {
    id: 'fresh-course',
    title: 'New course',
    topic: 'Loops',
    goal: 'Trace loops',
    description: 'Practical loops',
    level: 'beginner',
    language: 'English',
    estimatedMinutes: 40,
    modules: [
      {
        id: 'first',
        title: 'Foundations',
        description: 'Trace first',
        lessons: [
          {
            id: 'trace',
            title: 'Trace a loop',
            summary: 'Find the feedback',
            estimatedMinutes: 20,
          },
        ],
      },
      {
        id: 'second',
        title: 'Transfer',
        description: 'Try a fresh task',
        lessons: [
          { id: 'apply', title: 'Apply', summary: 'Transfer knowledge', estimatedMinutes: 20 },
        ],
      },
    ],
  })
  const draft = await createCourseDraft(workspace, plan)
  expect(
    (await loadCourseBundle(draft, [workspace])).modules.map(
      (module) => module.lessons[0]?.generationStatus,
    ),
  ).toEqual(['pending', 'pending'])
  await expect(createCourseDraft(workspace, plan)).rejects.toThrow('already exists')
  expect((await loadCourseBundle(draft, [workspace])).id).toBe('fresh-course')
  await expect(createCourseDraft(await root(), plan)).rejects.toThrow('inside this workspace')
})
