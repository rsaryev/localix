/**
 * A course's per-session progress file, and the one-writer-at-a-time rule around it.
 *
 * Every progress change is read → modify → write of this one file. Unordered, two quick step
 * completions (or the UI and the agent at once) both read the same `completedStepIds`, and the
 * later write dropped the other step — so changes go through {@link createKeyedQueue}, keyed per
 * course, which keeps different courses parallel.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { atomicWriteFile } from '@localixai/mini-app-sdk/backend'

import type { LearningCourse } from '../shared/contracts'
import { stepRevision } from './step-revision'

const STATE_FILE = '.learning-state.json'

export interface SessionCourseState {
  version: 1
  createdAt: string
  updatedAt: string
  activeLessonId: string | null
  activeStepId: string | null
  completedStepIds: string[]
  progress: LearningCourse['progress']
  assessments?: LearningCourse['assessments']
  stepRevisions?: Record<string, string>
  generation?: LearningCourse['generation']
}

function isSessionCourseState(value: unknown): value is SessionCourseState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<SessionCourseState>
  return (
    state.version === 1 &&
    typeof state.createdAt === 'string' &&
    typeof state.updatedAt === 'string' &&
    (typeof state.activeLessonId === 'string' || state.activeLessonId === null) &&
    (typeof state.activeStepId === 'string' || state.activeStepId === null) &&
    Array.isArray(state.completedStepIds) &&
    state.completedStepIds.every((id) => typeof id === 'string') &&
    !!state.progress &&
    typeof state.progress === 'object'
  )
}

export async function readState(rootDir: string): Promise<SessionCourseState | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(rootDir, STATE_FILE), 'utf8'))
    return isSessionCourseState(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function writeState(rootDir: string, state: SessionCourseState): Promise<void> {
  // The SDK's unique temp name: this one was keyed on pid + millisecond, so two writes in the
  // same millisecond shared a temp file and one rename failed.
  await atomicWriteFile(path.join(rootDir, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`)
}

export function stateOf(course: LearningCourse): SessionCourseState {
  return {
    version: 1,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    activeLessonId: course.activeLessonId,
    activeStepId: course.activeStepId,
    completedStepIds: course.completedStepIds,
    progress: course.progress,
    assessments: course.assessments,
    generation: course.generation,
    stepRevisions: Object.fromEntries(
      course.modules.flatMap((module) =>
        module.lessons.flatMap((lesson) =>
          lesson.steps.map((step) => [step.id, stepRevision(step)]),
        ),
      ),
    ),
  }
}

/** Runs `run` after every earlier change under the same key has settled, failed ones included. */
export type KeyedQueue = <T>(key: string, run: () => Promise<T>) => Promise<T>

export function createKeyedQueue(): KeyedQueue {
  const tails = new Map<string, Promise<unknown>>()
  return (key, run) => {
    const next = (tails.get(key) ?? Promise.resolve()).then(run, run)
    // The parked tail only ORDERS the next change: it never rejects (an unobserved rejection) and
    // never holds the result. Only the current tail clears its entry.
    const parked = next.then(
      () => undefined,
      () => undefined,
    )
    tails.set(key, parked)
    void parked.then(() => {
      if (tails.get(key) === parked) tails.delete(key)
    })
    return next
  }
}

export function courseKey(userId: string, sessionId: string, courseId: string): string {
  return `${userId}\0${sessionId}\0${courseId}`
}
