import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { classifyByAction, type MiniAppContext } from '@localixai/mini-app-sdk/backend'
import { learningCourseUri, learningLessonUri, learningStepUri } from '../shared/resource-uri'
import { lessons, lessonScore } from '../shared/progression'
import { formatCourseBundleError, loadCourseBundle } from './course-bundle'
import type { LearningService } from './service'
import type { LearningTutor } from './tutor'
import { createCourseDraft } from './course-draft'
import {
  LEARNING_CHANGES_CHANNEL,
  LEARNING_MINI_APP,
  type CourseChange,
} from '../shared/course-changes'

/**
 * Without a classifier the tool's static `mutates: true` read as `external`, so a read-only plan
 * session could not even read the format `guide` or `validate` a bundle. Reads stay reads;
 * `draft` writes course files into the project; `open` and `review` change only this chat's
 * progress and tutoring state (`session`). `activate` imports a bundle into the session's own data
 * directory, which is deleted with the chat — `session` too, so a plan conversation can open the
 * course it is planning around.
 */
export const classifyLearningCourseCall = classifyByAction({
  guide: { effect: 'read' },
  list: { effect: 'read' },
  get: { effect: 'read' },
  validate: { effect: 'read' },
  draft: { effect: 'files' },
  activate: { effect: 'session' },
  open: { effect: 'session' },
  review: { effect: 'session' },
})

export function createLearningCourseTool(
  ctx: MiniAppContext,
  service: LearningService,
  tutor: LearningTutor,
) {
  const { z } = ctx
  const id = z.string().trim().min(1).max(120)
  const inputSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('guide') }),
    z.object({ action: z.literal('list') }),
    z.object({ action: z.literal('draft'), outline_path: z.string().trim().min(1).max(2_000) }),
    z.object({
      action: z.literal('get'),
      course_id: id,
      lesson_id: id.optional(),
      step_id: id.optional(),
    }),
    z.object({
      action: z.literal('open'),
      course_id: id,
      lesson_id: id.optional(),
      step_id: id.optional(),
    }),
    z.object({ action: z.literal('validate'), manifest_path: z.string().trim().min(1).max(2_000) }),
    z.object({ action: z.literal('activate'), manifest_path: z.string().trim().min(1).max(2_000) }),
    z.object({
      action: z.literal('review'),
      course_id: id,
      step_id: id,
      submission_id: z.string().uuid(),
      passed: z.boolean(),
      feedback: z.string().trim().min(1).max(12_000),
    }),
  ])
  return ctx.defineTool({
    name: 'learning_course',
    label: 'Learning course',
    activeVerb: 'Working on learning course',
    description: [
      'Build and tutor file-authored courses in this chat. guide returns the exact bundle format and quality checklist on demand.',
      'draft creates all pending course/module/lesson files from a compact outline JSON file (format in guide) without overwriting a draft.',
      'list returns the library; get returns a compact outline, learner evidence and canonical manifest path (add lesson_id / step_id for focused content).',
      'Author with ordinary file tools under .localix/learning-drafts, or edit the canonical bundle of an existing course. Keep long prose in Markdown files.',
      'validate checks files without importing; activate validates and imports the course, and returns its resource_uri. Errors name the file to patch.',
      'open makes an unlocked lesson or step the active one; link it for the learner with the App view the result names. review records feedback for a current practice submission.',
      'Ask only for missing learning preferences. Preserve stable ids and unrelated material when adapting. Never mark practice passed without evidence for every criterion.',
    ].join('\n'),
    inputSchema,
    executionMode: 'sequential',
    mutates: true,
    classify: classifyLearningCourseCall,
    permissionPaths: (input) => {
      if (
        input &&
        typeof input === 'object' &&
        'manifest_path' in input &&
        typeof input.manifest_path === 'string'
      )
        return [dirname(resolve(ctx.cwd, input.manifest_path))]
      if (input && typeof input === 'object' && 'outline_path' in input)
        return [resolve(ctx.cwd, '.localix/learning-drafts')]
      return []
    },
    async execute(_toolCallId, input, signal, _onUpdate, context) {
      const sessionId = context?.session?.id
      if (!sessionId)
        return { content: 'A chat session is required for Learning courses.', isError: true }
      // The open course and library learn of this tool's changes only from this — see
      // `shared/course-changes.ts`. Said after the change landed, so a re-read sees it.
      const announce = (courseId: string) =>
        context?.session?.emitCommand?.(LEARNING_MINI_APP, LEARNING_CHANGES_CHANNEL, {
          courseId,
        } satisfies CourseChange)
      try {
        signal?.throwIfAborted()
        if (input.action === 'guide') {
          return {
            content: await readFile(
              resolve(ctx.miniAppDir, 'skills/build-learning-course/references/course-bundle.md'),
              'utf8',
            ),
          }
        }
        if (input.action === 'list')
          return { content: JSON.stringify(await service.list(ctx.userId, sessionId)) }
        if (input.action === 'draft')
          return {
            content: JSON.stringify({
              manifest_path: await createCourseDraft(ctx.cwd, input.outline_path),
              next: 'Author every lesson in the first module, then validate and activate.',
            }),
          }
        if (input.action === 'review') {
          const course = await tutor.review(
            ctx.userId,
            sessionId,
            input.course_id,
            input.step_id,
            input.submission_id,
            input.passed,
            input.feedback,
          )
          if (!course) throw new Error('Course not found')
          announce(course.id)
          return {
            content: JSON.stringify({
              reviewed: true,
              passed: input.passed,
              step_id: input.step_id,
            }),
            terminate: true,
          }
        }
        if (input.action === 'get' || input.action === 'open') {
          let course = await service.get(ctx.userId, sessionId, input.course_id)
          if (!course) throw new Error('Course not found')
          const lessonId =
            input.lesson_id ??
            (input.step_id
              ? lessons(course).find((lesson) =>
                  lesson.steps.some((step) => step.id === input.step_id),
                )?.id
              : undefined)
          const module = course.modules.find((item) =>
            item.lessons.some((lesson) => lesson.id === lessonId),
          )
          const lesson = module?.lessons.find((item) => item.id === lessonId)
          const step = lesson?.steps.find((item) => item.id === input.step_id)
          if (input.lesson_id && !lesson) throw new Error('Lesson not found')
          if (input.step_id && !step) throw new Error('Step not found')
          if (input.action === 'open') {
            if (lesson) {
              course =
                (await service.setActive(ctx.userId, sessionId, course.id, lesson.id, step?.id)) ??
                course
              announce(course.id)
            }
            const uri =
              module && lesson
                ? step
                  ? learningStepUri(course.id, module.id, lesson.id, step.id)
                  : learningLessonUri(course.id, module.id, lesson.id)
                : learningCourseUri(course.id)
            return {
              content: JSON.stringify({
                course_id: course.id,
                lesson_id: lesson?.id,
              }),
              details: ctx.ui.offer({ uri, label: course.title }),
            }
          }
          return {
            content: JSON.stringify({
              id: course.id,
              title: course.title,
              goal: course.goal,
              level: course.level,
              language: course.language,
              manifest_path: course.bundlePath,
              active_lesson_id: course.activeLessonId,
              active_step_id: course.activeStepId,
              ...(lesson
                ? {
                    lesson: step
                      ? { id: lesson.id, title: lesson.title, objectives: lesson.objectives, step }
                      : lesson,
                  }
                : {
                    modules: course.modules.map((item) => ({
                      id: item.id,
                      title: item.title,
                      lessons: item.lessons.map((entry) => ({
                        id: entry.id,
                        title: entry.title,
                        summary: entry.summary,
                        status: entry.generationStatus,
                        progress: course.progress[entry.id],
                        score: lessonScore(course, entry),
                      })),
                    })),
                  }),
              assessments: step ? { [step.id]: course.assessments?.[step.id] } : course.assessments,
              generation: course.generation,
            }),
          }
        }
        const storage = ctx.sessionStorage ?? ctx.host?.sessionStorage
        const roots = [
          ctx.cwd,
          ...(storage ? [await storage.resolveDataDir(ctx.userId, sessionId)] : []),
        ]
        const source = await loadCourseBundle(resolve(ctx.cwd, input.manifest_path), roots)
        signal?.throwIfAborted()
        if (input.action === 'validate')
          return {
            content: JSON.stringify({
              valid: true,
              course_id: source.id,
              files: source.filePaths.length,
              lessons: source.modules
                .flatMap((module) => module.lessons)
                .map((lesson) => ({
                  id: lesson.id,
                  status: lesson.generationStatus,
                  steps: lesson.steps.length,
                })),
            }),
          }
        const previous = await service.get(ctx.userId, sessionId, source.id)
        if (
          !previous &&
          source.modules[0]?.lessons.some((lesson) => lesson.generationStatus !== 'ready')
        )
          throw new Error(
            'Prepare every lesson in the first module before activating a new course. Later modules remain pending and warm automatically.',
          )
        const course = await service.activateBundle(ctx.userId, sessionId, source)
        announce(course.id)
        const uri = learningCourseUri(course.id)
        return {
          content: JSON.stringify({
            activated: true,
            course_id: course.id,
            title: course.title,
            manifest_path: course.bundlePath,
            resource_uri: uri,
          }),
          details: ctx.ui.offer({
            uri,
            label: `Open ${course.title}`,
            description: 'Continue in Learning Studio',
          }),
        }
      } catch (error) {
        if (signal?.aborted) throw error
        return { content: formatCourseBundleError(error), isError: true }
      }
    },
  })
}
