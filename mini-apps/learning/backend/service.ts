import { mkdir, readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'

import { encodeResourceSegment } from '@localixai/mini-app-sdk/backend'

import type {
  CourseSummary,
  LearningCourse,
  ProgressUpdate,
  StepEvidence,
} from '../shared/contracts'
import { lessons, lessonUnlocked, stepUnlocked, lessonScore } from '../shared/progression'
import { materializeCourse } from './materialize-course'
import { recordEvidence } from './step-evidence'
import { courseSummary } from './course-summary'
import { importCourseBundle } from './course-import'
import { loadCourseBundle, type LoadedCourseBundle } from './course-bundle'
import { materializePortableCourse, serializeCourseBundle } from './course-portable'
import { courseKey, createKeyedQueue, readState, stateOf, writeState } from './course-state'

export type ResolveSessionDataDir = (userId: string, sessionId: string) => Promise<string>

// Routes and per-run tool registrations have separate service instances, but write the same files.
const serialized = createKeyedQueue()

export class LearningService {
  constructor(private readonly resolveSessionDataDir: ResolveSessionDataDir) {}

  /** One progress change at a time per course — see `course-state.ts` for the lost update. */
  private readonly serialized = serialized

  change(
    userId: string,
    sessionId: string,
    courseId: string,
    update: (course: LearningCourse) => LearningCourse | Promise<LearningCourse>,
  ): Promise<LearningCourse | null> {
    return this.serialized(courseKey(userId, sessionId, courseId), async () => {
      const course = await this.get(userId, sessionId, courseId)
      if (!course) return null
      const next = await update(course)
      return next === course ? course : this.save(next)
    })
  }

  private async coursesDir(userId: string, sessionId: string): Promise<string> {
    return path.join(await this.resolveSessionDataDir(userId, sessionId), 'courses')
  }

  async list(userId: string, sessionId: string): Promise<CourseSummary[]> {
    const coursesDir = await this.coursesDir(userId, sessionId)
    let entries: Dirent[]
    try {
      entries = await readdir(coursesDir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const loaded = await Promise.allSettled(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.includes('.incoming-'))
        .map((entry) => this.get(userId, sessionId, entry.name)),
    )
    return loaded
      .flatMap((result) => (result.status === 'fulfilled' && result.value ? [result.value] : []))
      .map(courseSummary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async get(userId: string, sessionId: string, courseId: string): Promise<LearningCourse | null> {
    const rootDir = path.join(
      await this.coursesDir(userId, sessionId),
      encodeResourceSegment(courseId),
    )
    const manifestPath = path.join(rootDir, 'course.json')
    try {
      const bundle = await loadCourseBundle(manifestPath, [rootDir])
      if (bundle.id !== courseId) return null
      return materializeCourse(sessionId, manifestPath, bundle, await readState(rootDir))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      const cause = (error as Error & { cause?: NodeJS.ErrnoException }).cause
      if (cause?.code === 'ENOENT') return null
      throw error
    }
  }

  activateBundle(
    userId: string,
    sessionId: string,
    source: LoadedCourseBundle,
  ): Promise<LearningCourse> {
    return this.serialized(courseKey(userId, sessionId, source.id), () =>
      this.activateBundleNow(userId, sessionId, source),
    )
  }

  setActive(
    userId: string,
    sessionId: string,
    courseId: string,
    lessonId: string,
    stepId?: string,
  ): Promise<LearningCourse | null> {
    return this.serialized(courseKey(userId, sessionId, courseId), () =>
      this.setActiveNow(userId, sessionId, courseId, lessonId, stepId),
    )
  }

  completeStep(
    userId: string,
    sessionId: string,
    courseId: string,
    lessonId: string,
    stepId: string,
    evidence?: StepEvidence,
  ): Promise<LearningCourse | null> {
    return this.serialized(courseKey(userId, sessionId, courseId), () =>
      this.completeStepNow(userId, sessionId, courseId, lessonId, stepId, evidence),
    )
  }

  updateProgress(
    userId: string,
    sessionId: string,
    courseId: string,
    update: ProgressUpdate,
  ): Promise<LearningCourse | null> {
    return this.serialized(courseKey(userId, sessionId, courseId), () =>
      this.updateProgressNow(userId, sessionId, courseId, update),
    )
  }

  private async activateBundleNow(
    userId: string,
    sessionId: string,
    source: LoadedCourseBundle,
  ): Promise<LearningCourse> {
    // A broken canonical copy must not prevent a repaired draft from replacing
    // it. Preserve progress when readable; otherwise activation reconstructs the
    // course from the newly validated source.
    const previous = await this.get(userId, sessionId, source.id).catch(() => null)
    const dataDir = await this.resolveSessionDataDir(userId, sessionId)
    const imported = await importCourseBundle(source, dataDir)
    const previousState = previous ? stateOf(previous) : null
    const now = new Date().toISOString()
    const course = materializeCourse(
      sessionId,
      imported.manifestPath,
      imported.bundle,
      previousState && { ...previousState, updatedAt: now },
    )
    await writeState(imported.bundle.rootDir, stateOf(course))
    return course
  }

  async exportPortable(
    userId: string,
    sessionId: string,
    courseId: string,
  ): Promise<string | null> {
    const course = await this.get(userId, sessionId, courseId)
    if (!course) return null
    const rootDir = path.dirname(course.bundlePath)
    return serializeCourseBundle(await loadCourseBundle(course.bundlePath, [rootDir]))
  }

  async importPortable(
    userId: string,
    sessionId: string,
    serialized: string,
  ): Promise<LearningCourse> {
    const portable = await materializePortableCourse(serialized)
    try {
      if (await this.get(userId, sessionId, portable.bundle.id)) {
        throw new Error(
          `A course with id "${portable.bundle.id}" already exists in this session. Rename its id before sharing or import it into another session.`,
        )
      }
      return await this.activateBundle(userId, sessionId, portable.bundle)
    } finally {
      await portable.cleanup()
    }
  }

  private async save(course: LearningCourse): Promise<LearningCourse> {
    await mkdir(path.dirname(course.bundlePath), { recursive: true })
    await writeState(path.dirname(course.bundlePath), stateOf(course))
    return course
  }

  private async setActiveNow(
    userId: string,
    sessionId: string,
    courseId: string,
    lessonId: string,
    stepId?: string,
  ): Promise<LearningCourse | null> {
    const course = await this.get(userId, sessionId, courseId)
    if (!course) return null
    const lesson = lessons(course).find((item) => item.id === lessonId)
    if (!lesson) throw new Error('Unknown lesson')
    if (!lessonUnlocked(course, lessonId)) throw new Error('Complete the previous lesson first')
    if (stepId && !lesson.steps.some((step) => step.id === stepId)) throw new Error('Unknown step')
    if (stepId && !stepUnlocked(course, lesson, stepId)) {
      throw new Error('Complete the previous step first')
    }
    const now = new Date().toISOString()
    const previous = course.progress[lessonId]
    return this.save({
      ...course,
      activeLessonId: lessonId,
      activeStepId:
        stepId ??
        lesson.steps.find((step) => !course.completedStepIds.includes(step.id))?.id ??
        lesson.steps[0]?.id ??
        null,
      updatedAt: now,
      progress: {
        ...course.progress,
        [lessonId]: {
          status: previous?.status === 'completed' ? 'completed' : 'in-progress',
          attempts: previous?.attempts ?? 0,
          ...(previous?.score === undefined ? {} : { score: previous.score }),
          ...(previous?.confidence === undefined ? {} : { confidence: previous.confidence }),
          updatedAt: now,
        },
      },
    })
  }

  private async completeStepNow(
    userId: string,
    sessionId: string,
    courseId: string,
    lessonId: string,
    stepId: string,
    evidence?: StepEvidence,
  ): Promise<LearningCourse | null> {
    const course = await this.get(userId, sessionId, courseId)
    if (!course) return null
    const lesson = lessons(course).find((item) => item.id === lessonId)
    if (!lesson) throw new Error('Unknown lesson')
    if (!lessonUnlocked(course, lessonId)) throw new Error('Complete the previous lesson first')
    const step = lesson.steps.find((step) => step.id === stepId)
    if (!step) throw new Error('Unknown step')
    if (!stepUnlocked(course, lesson, stepId)) throw new Error('Complete the previous step first')
    const assessed = recordEvidence(course, step, evidence)
    const accepted = step.type !== 'quiz' || assessed.assessments?.[step.id]?.correct === true
    return this.save({
      ...assessed,
      activeLessonId: lessonId,
      activeStepId: stepId,
      completedStepIds:
        !accepted || course.completedStepIds.includes(stepId)
          ? course.completedStepIds
          : [...course.completedStepIds, stepId],
      updatedAt: new Date().toISOString(),
    })
  }

  private async updateProgressNow(
    userId: string,
    sessionId: string,
    courseId: string,
    update: ProgressUpdate,
  ): Promise<LearningCourse | null> {
    const course = await this.get(userId, sessionId, courseId)
    if (!course) return null
    const lesson = lessons(course).find((item) => item.id === update.lessonId)
    if (!lesson) throw new Error('Unknown lesson')
    if (update.status === 'completed' && lesson.generationStatus !== 'ready')
      throw new Error('Wait until this module is ready before completing the lesson')
    if (!lessonUnlocked(course, update.lessonId)) {
      throw new Error('Complete the previous lesson first')
    }
    if (
      update.status === 'completed' &&
      lesson.steps.some((step) => !course.completedStepIds.includes(step.id))
    ) {
      throw new Error('Complete every lesson step first')
    }
    const previous = course.progress[update.lessonId]
    // Completion is a terminal, idempotent transition. Re-clicking a delayed UI
    // response must not manufacture extra attempts or rewrite the completion time.
    if (previous?.status === 'completed' && update.status === 'completed') return course
    const now = new Date().toISOString()
    return this.save({
      ...course,
      activeLessonId: update.lessonId,
      updatedAt: now,
      progress: {
        ...course.progress,
        [update.lessonId]: {
          status: update.status,
          attempts: (previous?.attempts ?? 0) + (update.status === 'completed' ? 1 : 0),
          ...((lessonScore(course, lesson) ?? update.score) === undefined
            ? {}
            : { score: lessonScore(course, lesson) ?? update.score }),
          ...(update.confidence === undefined ? {} : { confidence: update.confidence }),
          updatedAt: now,
        },
      },
    })
  }
}
