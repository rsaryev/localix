import { realpath } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

import { validationError } from './course-bundle-errors'
import {
  courseManifest,
  moduleManifest,
  lessonManifest,
  stepManifest,
} from './course-bundle-schema'
import {
  contained,
  readCapped,
  readJson,
  resolveReference,
  markdown,
  MAX_MARKDOWN_BYTES,
} from './course-bundle-files'

import type {
  CourseModule,
  CourseOutlineDraft,
  LearningObjective,
  Lesson,
  LessonStep,
} from '../shared/contracts'

const MAX_QUIZ_STEPS_PER_LESSON = 10

export interface LoadedCourseBundle {
  id: string
  rootDir: string
  manifestPath: string
  /** Canonical files reachable from the bundle manifests; excludes progress and unrelated files. */
  filePaths: string[]
  outline: CourseOutlineDraft
  modules: CourseModule[]
}

export { CourseBundleValidationError, formatCourseBundleError } from './course-bundle-errors'
export type { CourseBundleDiagnostic } from './course-bundle-errors'

async function loadStep(path: string, root: string, filePaths: Set<string>): Promise<LessonStep> {
  const value = await readJson(path, stepManifest)
  if (value.type === 'concept') {
    return {
      id: value.id,
      type: value.type,
      title: value.title,
      body: await markdown(path, value.content, root, filePaths),
      ...(value.keyPoints ? { keyPoints: value.keyPoints } : {}),
    }
  }
  if (value.type === 'code') {
    const source = await resolveReference(path, value.source, root, filePaths)
    return {
      id: value.id,
      type: value.type,
      title: value.title,
      language: value.language,
      code: await readCapped(source, MAX_MARKDOWN_BYTES),
      ...(value.content
        ? { explanation: await markdown(path, value.content, root, filePaths) }
        : {}),
    }
  }
  if (value.type === 'quiz') {
    if (!value.options.some((option) => option.id === value.correctOptionId)) {
      throw validationError({
        code: 'invalid-manifest',
        file: path,
        field: 'correctOptionId',
        message: `"${value.correctOptionId}" does not match any option id in quiz "${value.id}".`,
        fix: 'Set correctOptionId to one of the option ids declared in this step.',
      })
    }
    return {
      id: value.id,
      type: value.type,
      question: value.question,
      options: value.options,
      correctOptionId: value.correctOptionId,
      explanation: await markdown(path, value.explanation, root, filePaths),
    }
  }
  if (value.type === 'practice') {
    return {
      id: value.id,
      type: value.type,
      title: value.title,
      prompt: await markdown(path, value.prompt, root, filePaths),
      acceptanceCriteria: value.acceptanceCriteria,
      ...(value.hint ? { hint: await markdown(path, value.hint, root, filePaths) } : {}),
    }
  }
  return value
}

interface IdDeclaration {
  file: string
  field: string
}

function assertUnique(
  ids: Map<string, IdDeclaration>,
  value: string,
  declaration: IdDeclaration,
): void {
  const first = ids.get(value)
  if (first) {
    throw validationError({
      code: 'duplicate-id',
      file: declaration.file,
      field: declaration.field,
      message: `Id "${value}" is already declared at ${first.file} (${first.field}).`,
      fix: 'Rename only this duplicate id and update references to it; keep the first declaration stable.',
    })
  }
  ids.set(value, declaration)
}

function stage(step: LessonStep): number {
  if (step.type === 'concept' || step.type === 'code' || step.type === 'walkthrough') return 0
  if (step.type === 'quiz' || step.type === 'flashcards') return 1
  return 2
}

function validateReadyLesson(lesson: Lesson, path: string): void {
  if (lesson.generationStatus === 'pending') {
    if (lesson.steps.length || lesson.objectives.length) {
      throw validationError({
        code: 'invalid-progression',
        file: path,
        field: lesson.steps.length ? 'steps' : 'objectives',
        message: `Pending lesson "${lesson.id}" contains authored material.`,
        fix: 'Either clear objectives and steps, or mark the lesson ready and provide theory, testing, and practice.',
      })
    }
    return
  }
  const stages = lesson.steps.map(stage)
  const quizCount = lesson.steps.filter((step) => step.type === 'quiz').length
  if (quizCount > MAX_QUIZ_STEPS_PER_LESSON) {
    throw validationError({
      code: 'invalid-progression',
      file: path,
      field: 'steps',
      message: `Lesson "${lesson.id}" contains ${quizCount} quiz questions; the limit is ${MAX_QUIZ_STEPS_PER_LESSON}.`,
      fix: 'Keep the strongest diagnostic questions and remove the remaining quiz step references from this lesson.',
    })
  }
  if (!stages.includes(0) || !stages.includes(1) || !stages.includes(2)) {
    throw validationError({
      code: 'invalid-progression',
      file: path,
      field: 'steps',
      message: `Ready lesson "${lesson.id}" must include theory, testing, and practice.`,
      fix: 'Add the missing stage as a referenced step manifest, or keep the lesson pending.',
    })
  }
  if (stages.some((value, index) => index > 0 && value < stages[index - 1]!)) {
    throw validationError({
      code: 'invalid-progression',
      file: path,
      field: 'steps',
      message: `Lesson "${lesson.id}" does not follow theory → testing → practice.`,
      fix: 'Reorder only the step references in this lesson.json.',
    })
  }
}

export async function loadCourseBundle(
  requestedManifestPath: string,
  allowedRoots: readonly string[],
): Promise<LoadedCourseBundle> {
  let manifestPath: string
  try {
    manifestPath = await realpath(requestedManifestPath)
  } catch (cause) {
    throw validationError(
      {
        code: 'invalid-root',
        file: requestedManifestPath,
        message: 'The requested root course.json does not exist or cannot be read.',
        fix: 'Pass the absolute or workspace-relative path to the existing root course.json.',
      },
      cause,
    )
  }
  const canonicalRoots = await Promise.all(allowedRoots.map((root) => realpath(root)))
  if (!canonicalRoots.some((root) => contained(root, manifestPath))) {
    throw validationError({
      code: 'invalid-root',
      file: manifestPath,
      message: 'The course manifest is outside the workspace and mini app data directories.',
      fix: 'Author the bundle under the workspace .localix/learning-drafts directory.',
    })
  }
  // The basename, not a suffix: `endsWith('course.json')` let `mycourse.json` through.
  if (basename(manifestPath) !== 'course.json') {
    throw validationError({
      code: 'invalid-root',
      file: manifestPath,
      message: 'The root manifest filename must be course.json.',
      fix: 'Pass the course root course.json, not a module, lesson, or step manifest.',
    })
  }
  const rootDir = dirname(manifestPath)
  const filePaths = new Set<string>([manifestPath])
  const manifest = await readJson(manifestPath, courseManifest)
  const ids = new Map<string, IdDeclaration>()
  assertUnique(ids, manifest.id, { file: manifestPath, field: 'id' })
  const modules: CourseModule[] = []
  for (const moduleRef of manifest.modules) {
    const modulePath = await resolveReference(manifestPath, moduleRef, rootDir, filePaths)
    const module = await readJson(modulePath, moduleManifest)
    assertUnique(ids, module.id, { file: modulePath, field: 'id' })
    const loadedLessons: Lesson[] = []
    for (const lessonRef of module.lessons) {
      const lessonPath = await resolveReference(modulePath, lessonRef, rootDir, filePaths)
      const lesson = await readJson(lessonPath, lessonManifest)
      assertUnique(ids, lesson.id, { file: lessonPath, field: 'id' })
      const objectives: LearningObjective[] = lesson.objectives
      for (let index = 0; index < objectives.length; index += 1) {
        const item = objectives[index]!
        assertUnique(ids, item.id, { file: lessonPath, field: `objectives.${index}.id` })
      }
      const steps: LessonStep[] = []
      for (const stepRef of lesson.steps) {
        const stepPath = await resolveReference(lessonPath, stepRef, rootDir, filePaths)
        const item = await loadStep(stepPath, rootDir, filePaths)
        assertUnique(ids, item.id, { file: stepPath, field: 'id' })
        steps.push(item)
      }
      const loaded: Lesson = { ...lesson, objectives, steps }
      validateReadyLesson(loaded, lessonPath)
      loadedLessons.push(loaded)
    }
    modules.push({ ...module, lessons: loadedLessons })
  }
  const { schemaVersion: _schemaVersion, id: courseId, modules: _modules, ...outline } = manifest
  return {
    id: courseId,
    rootDir,
    manifestPath,
    filePaths: [...filePaths],
    outline: { ...outline, modules: [] },
    modules,
  }
}
