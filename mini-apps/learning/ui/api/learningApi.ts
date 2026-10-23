import { miniAppApiFetch, postMiniAppJson as postJson } from '@localixai/mini-app-sdk/ui/transport'

import { LEARNING_COURSES } from '../model/topics'

import type {
  CourseListResponse,
  CourseResponse,
  LearningCourse,
  MaybeCourseResponse,
  ProgressUpdate,
  StepEvidence,
} from '../../shared/contracts'

const BASE = '/rpc/learning'
const MAX_PORTABLE_COURSE_BYTES = 12 * 1024 * 1024

export class LearningApiError extends Error {
  /** The raw text behind the sentence — a parser's or the filesystem's. Event Center only. */
  readonly detail?: string
  constructor(message: string, detail?: string) {
    super(message)
    this.name = 'LearningApiError'
    this.detail = detail
  }
}

async function readOr<T>(response: Response): Promise<T> {
  const json = (await response.json().catch(() => null)) as
    | (T & { error?: string; detail?: string })
    | null
  if (!response.ok || (json && typeof json.error === 'string')) {
    throw new LearningApiError(
      json?.error ?? 'The course could not be updated. Try again.',
      json?.detail ?? `HTTP ${response.status}`,
    )
  }
  return json as T
}

function currentCourse(course: LearningCourse | null): LearningCourse | null {
  return course?.version === 4 &&
    Array.isArray(course.modules) &&
    Array.isArray(course.completedStepIds)
    ? course
    : null
}

export const learningApi = {
  async list(sessionId: string) {
    const query = new URLSearchParams({ sessionId })
    const response = await miniAppApiFetch(`${BASE}/courses?${query}`)
    return (await readOr<CourseListResponse>(response)).courses
  },

  async get(sessionId: string, courseId: string): Promise<LearningCourse | null> {
    const query = new URLSearchParams({ sessionId, courseId })
    const response = await miniAppApiFetch(`${BASE}/course?${query}`)
    return currentCourse((await readOr<MaybeCourseResponse>(response)).course)
  },

  async exportCourse(
    sessionId: string,
    courseId: string,
  ): Promise<{ blob: Blob; filename: string }> {
    const query = new URLSearchParams({ sessionId, courseId })
    const response = await miniAppApiFetch(`${BASE}/course/export?${query}`)
    if (!response.ok) {
      const failure = await response.json().catch(() => null)
      throw new LearningApiError(
        failure && typeof failure.error === 'string'
          ? failure.error
          : `Export failed (${response.status})`,
      )
    }
    const disposition = response.headers.get('content-disposition') ?? ''
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${courseId}.localix-course`
    return { blob: await response.blob(), filename }
  },

  async importCourse(sessionId: string, file: File): Promise<LearningCourse> {
    if (file.size > MAX_PORTABLE_COURSE_BYTES) {
      throw new LearningApiError('The selected course file is too large.')
    }
    const query = new URLSearchParams({ sessionId })
    const response = await miniAppApiFetch(`${BASE}/course/import?${query}`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/vnd.localix.learning-course+json',
      },
      body: file,
    })
    const course = (await readOr<CourseResponse>(response)).course
    LEARNING_COURSES.invalidate(sessionId)
    return course
  },

  async setActive(
    sessionId: string,
    courseId: string,
    lessonId: string,
    stepId?: string,
  ): Promise<LearningCourse> {
    const response = await postJson(`${BASE}/course/active`, {
      sessionId,
      courseId,
      lessonId,
      ...(stepId ? { stepId } : {}),
    })
    const course = (await readOr<CourseResponse>(response)).course
    LEARNING_COURSES.invalidate(sessionId)
    return course
  },

  async updateProgress(
    sessionId: string,
    courseId: string,
    update: ProgressUpdate,
  ): Promise<LearningCourse> {
    const response = await postJson(`${BASE}/course/progress`, { sessionId, courseId, ...update })
    const course = (await readOr<CourseResponse>(response)).course
    LEARNING_COURSES.invalidate(sessionId)
    return course
  },

  async completeStep(
    sessionId: string,
    courseId: string,
    lessonId: string,
    stepId: string,
    evidence?: StepEvidence,
  ): Promise<LearningCourse> {
    const response = await postJson(`${BASE}/course/step`, {
      sessionId,
      courseId,
      lessonId,
      stepId,
      ...evidence,
    })
    const course = (await readOr<CourseResponse>(response)).course
    LEARNING_COURSES.invalidate(sessionId)
    return course
  },

  async submitPractice(
    sessionId: string,
    courseId: string,
    lessonId: string,
    stepId: string,
    response: string,
  ): Promise<LearningCourse> {
    const result = await postJson(`${BASE}/course/practice`, {
      sessionId,
      courseId,
      lessonId,
      stepId,
      response,
    })
    const course = (await readOr<CourseResponse>(result)).course
    LEARNING_COURSES.invalidate(sessionId)
    return course
  },
}
