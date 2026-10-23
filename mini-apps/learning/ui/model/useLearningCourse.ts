import { useCallback, useEffect, useRef, useState } from 'react'
import type { LearningCourse, StepEvidence } from '../../shared/contracts'
import { parseLearningResourceUri } from '../../shared/resource-uri'
import { activeLesson, activeStep, nextLesson, previousLesson } from './course'
import { LearningApiError, learningApi } from '../api/learningApi'
import { useCourseChanges } from './courseChanges'

/** A late poll must not overwrite navigation or a saved answer with older course state. */
export function useLearningCourse(
  sessionId: string,
  courseId: string,
  visible: boolean,
  initialResourceUri?: string,
) {
  const [course, setCourse] = useState<LearningCourse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<{ message: string; detail?: string } | null>(null)
  const request = useRef(0)
  const writing = useRef(false)
  const applied = useRef<string | null>(null)
  const failureSource = useRef<'read' | 'write' | null>(null)
  const fail = useCallback(
    (cause: unknown) =>
      setFailure({
        message:
          cause instanceof LearningApiError ? cause.message : 'The course could not be updated.',
        detail:
          cause instanceof LearningApiError
            ? cause.detail
            : cause instanceof Error
              ? cause.message
              : String(cause),
      }),
    [],
  )
  const invalidate = useCallback(() => {
    request.current++
  }, [])
  const refresh = useCallback(async () => {
    if (writing.current) return
    const sequence = ++request.current
    try {
      const next = await learningApi.get(sessionId, courseId)
      if (sequence !== request.current) return
      setCourse(next)
      if (failureSource.current !== 'write') setFailure(null)
    } catch (cause) {
      if (sequence === request.current && failureSource.current !== 'write') {
        failureSource.current = 'read'
        fail(cause)
      }
    } finally {
      if (sequence === request.current) setLoading(false)
    }
  }, [sessionId, courseId, fail])
  useEffect(() => {
    invalidate()
    writing.current = false
    failureSource.current = null
    setBusy(false)
    setLoading(true)
    setCourse(null)
    setFailure(null)
    applied.current = null
    void refresh()
    return invalidate
  }, [refresh, invalidate])
  useCourseChanges(sessionId, visible, refresh)
  const run = useCallback(
    async (change: () => Promise<LearningCourse | null>) => {
      if (writing.current) throw new Error('A course change is already being saved')
      writing.current = true
      const sequence = ++request.current
      setBusy(true)
      setFailure(null)
      failureSource.current = null
      try {
        const next = await change()
        if (sequence === request.current) setCourse(next)
        return next
      } catch (cause) {
        if (sequence === request.current) {
          failureSource.current = 'write'
          fail(cause)
        }
        throw cause
      } finally {
        if (sequence === request.current) {
          writing.current = false
          setBusy(false)
        }
      }
    },
    [fail],
  )
  const choose = useCallback(
    async (lessonId: string, stepId?: string) => {
      try {
        await run(() => learningApi.setActive(sessionId, courseId, lessonId, stepId))
      } catch {
        /* Reported above. */
      }
    },
    [run, sessionId, courseId],
  )
  useEffect(() => {
    if (!course || !initialResourceUri || applied.current === initialResourceUri || busy) return
    const resource = parseLearningResourceUri(initialResourceUri)
    if (!resource || resource.courseId !== course.id) return
    applied.current = initialResourceUri
    const lessonId =
      resource.kind === 'lesson' || resource.kind === 'step'
        ? resource.lessonId
        : resource.kind === 'module'
          ? course.modules.find((module) => module.id === resource.moduleId)?.lessons[0]?.id
          : undefined
    if (lessonId) void choose(lessonId, resource.kind === 'step' ? resource.stepId : undefined)
  }, [course, initialResourceUri, busy, choose])
  const location = course ? activeLesson(course) : null
  const step = course && location ? activeStep(course, location.lesson) : null
  const submitAnswer = async (stepId: string, evidence: StepEvidence) => {
    if (!location) return
    await run(() =>
      learningApi.completeStep(sessionId, courseId, location.lesson.id, stepId, evidence),
    )
  }
  const submitPractice = async (stepId: string, response: string) => {
    if (!location) return
    await run(() =>
      learningApi.submitPractice(sessionId, courseId, location.lesson.id, stepId, response),
    )
  }
  const forward = async (recalled: boolean) => {
    if (!course || !location || !step || busy) return
    try {
      await run(async () => {
        const stepped = await learningApi.completeStep(
          sessionId,
          courseId,
          location.lesson.id,
          step.id,
          { recalled },
        )
        const followingStep =
          location.lesson.steps[location.lesson.steps.findIndex((item) => item.id === step.id) + 1]
        if (followingStep)
          return learningApi.setActive(sessionId, courseId, location.lesson.id, followingStep.id)
        const finished = await learningApi.updateProgress(sessionId, courseId, {
          lessonId: location.lesson.id,
          status: 'completed',
        })
        const following = nextLesson(finished, location.lesson.id)
        return following
          ? learningApi.setActive(sessionId, courseId, following.lesson.id)
          : stepped && finished
      })
    } catch {
      /* Reported above. */
    }
  }
  const back = async () => {
    if (!course || !location || busy) return
    const previousStep =
      step &&
      location.lesson.steps[location.lesson.steps.findIndex((item) => item.id === step.id) - 1]
    const previous = previousLesson(course, location.lesson.id)
    if (previousStep) await choose(location.lesson.id, previousStep.id)
    else if (previous) await choose(previous.lesson.id, previous.lesson.steps.at(-1)?.id)
  }
  return {
    course,
    loading,
    busy,
    failure,
    failureIsWrite: failureSource.current === 'write',
    location,
    step,
    choose,
    submitAnswer,
    submitPractice,
    forward,
    back,
  }
}
