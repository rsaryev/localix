import type {
  ResourceExpansion,
  ResourceNode,
  ResourceRefProvider,
} from '@localixai/mini-app-sdk/backend'

import type { LearningCourse, LessonStep } from '../shared/contracts'
import { stepStage as stage, stepTitle } from '../shared/progression'
import {
  LEARNING_RESOURCE_PROVIDER,
  learningCourseUri,
  learningLessonUri,
  learningModuleUri,
  learningStepUri,
  parseLearningResourceUri,
} from '../shared/resource-uri'
import type { LearningService } from './service'

function includesQuery(values: string[], query?: string): boolean {
  const normalized = query?.trim().toLocaleLowerCase()
  return !normalized || values.some((value) => value.toLocaleLowerCase().includes(normalized))
}

function stepStage(step: LessonStep): string {
  return { theory: 'Theory', test: 'Test', practice: 'Practice' }[stage(step)]
}

function stepMarkdown(step: LessonStep): string {
  switch (step.type) {
    case 'concept':
      return [
        `# ${step.title}`,
        'Stage: Theory',
        '',
        step.body,
        ...(step.keyPoints?.length
          ? ['', 'Key points:', ...step.keyPoints.map((point) => `- ${point}`)]
          : []),
      ].join('\n')
    case 'code':
      return [
        `# ${step.title}`,
        'Stage: Theory · worked example',
        '',
        `\`\`\`${step.language}`,
        step.code,
        '```',
        step.explanation ?? '',
      ]
        .filter(Boolean)
        .join('\n')
    case 'quiz':
      return [
        `# ${step.question}`,
        'Stage: Test',
        '',
        ...step.options.map((option) => `- ${option.id}: ${option.label}`),
        `Answer: ${step.correctOptionId}`,
        `Feedback: ${step.explanation}`,
      ].join('\n')
    case 'flashcards':
      return [
        `# ${step.title}`,
        'Stage: Test · active recall',
        '',
        ...step.cards.map((card) => `- ${card.front} — ${card.back}`),
      ].join('\n')
    case 'walkthrough':
      return [
        `# ${step.title}`,
        'Stage: Theory · guided example',
        '',
        ...step.steps.map((item, index) => `${index + 1}. **${item.label}** — ${item.detail}`),
      ].join('\n')
    case 'practice':
      return [
        `# ${step.title}`,
        'Stage: Practice',
        '',
        step.prompt,
        '',
        'Acceptance criteria:',
        ...step.acceptanceCriteria.map((criterion) => `- ${criterion}`),
        step.hint ? `Hint: ${step.hint}` : '',
      ]
        .filter(Boolean)
        .join('\n')
  }
}

function findLesson(course: LearningCourse, moduleId: string, lessonId: string) {
  const module = course.modules.find((item) => item.id === moduleId)
  const lesson = module?.lessons.find((item) => item.id === lessonId)
  return module && lesson ? { module, lesson } : null
}

export function createLearningResourceProvider(service: LearningService): ResourceRefProvider {
  return {
    provider: LEARNING_RESOURCE_PROVIDER,
    title: 'Learning',

    async listChildren(userId, parentUri, query, scope): Promise<ResourceNode[]> {
      if (!scope?.sessionId) return []
      if (parentUri === null) {
        return (await service.list(userId, scope.sessionId))
          .filter((course) => includesQuery([course.title, course.description], query))
          .map((course) => ({
            uri: learningCourseUri(course.id),
            label: course.title,
            detail: `${course.completedLessons}/${course.totalLessons} lessons`,
            hasChildren: true,
            navigationOnly: true,
            icon: 'course',
          }))
      }

      const node = parseLearningResourceUri(parentUri)
      if (!node) return []
      const course = await service.get(userId, scope.sessionId, node.courseId)
      if (!course) return []

      if (node.kind === 'course') {
        return course.modules
          .filter((module) => includesQuery([module.title, module.description], query))
          .map((module) => ({
            uri: learningModuleUri(course.id, module.id),
            label: module.title,
            detail: `${module.lessons.length} lessons`,
            hasChildren: true,
            navigationOnly: true,
            icon: 'module',
          }))
      }
      if (node.kind === 'module') {
        const module = course.modules.find((item) => item.id === node.moduleId)
        if (!module) return []
        return module.lessons
          .filter((lesson) => includesQuery([lesson.title, lesson.summary], query))
          .map((lesson) => ({
            uri: learningLessonUri(course.id, module.id, lesson.id),
            label: lesson.title,
            detail:
              lesson.generationStatus === 'ready'
                ? `${lesson.estimatedMinutes} min · ${course.progress[lesson.id]?.status ?? 'not started'}`
                : `${lesson.estimatedMinutes} min · material pending`,
            hasChildren: lesson.steps.length > 0,
            navigationOnly: lesson.steps.length > 0,
            icon: 'lesson',
          }))
      }
      if (node.kind === 'lesson') {
        const location = findLesson(course, node.moduleId, node.lessonId)
        if (!location) return []
        return location.lesson.steps
          .filter((step) => includesQuery([stepTitle(step), stepStage(step)], query))
          .map((step) => ({
            uri: learningStepUri(course.id, node.moduleId, node.lessonId, step.id),
            label: stepTitle(step),
            detail: stepStage(step),
            hasChildren: false,
            icon: step.type,
          }))
      }
      return []
    },

    async expand(userId, uri, scope): Promise<ResourceExpansion> {
      if (!scope?.sessionId) return { ok: false, error: 'a session is required' }
      const node = parseLearningResourceUri(uri)
      if (!node) return { ok: false, error: 'not a learning resource' }
      const course = await service.get(userId, scope.sessionId, node.courseId)
      if (!course) return { ok: false, error: 'course not found' }

      if (node.kind === 'course') {
        return {
          ok: true,
          language: 'markdown',
          content: [
            `# ${course.title}`,
            course.description,
            `Topic: ${course.topic}`,
            `Goal: ${course.goal}`,
            `Level: ${course.level}`,
            '',
            '# Course modules',
            ...course.modules.map(
              (module) =>
                `## ${module.title}\n${module.description}\n${module.lessons
                  .map(
                    (lesson) => `- ${lesson.title}: ${lesson.summary} [${lesson.generationStatus}]`,
                  )
                  .join('\n')}`,
            ),
          ].join('\n'),
        }
      }
      if (node.kind === 'module') {
        const module = course.modules.find((item) => item.id === node.moduleId)
        if (!module) return { ok: false, error: 'module not found' }
        return {
          ok: true,
          language: 'markdown',
          content: [
            `# ${module.title}`,
            `Course: ${course.title}`,
            module.description,
            '',
            ...module.lessons.map(
              (lesson) =>
                `- **${lesson.title}** (${lesson.estimatedMinutes} min, ${lesson.generationStatus}) — ${lesson.summary}`,
            ),
          ].join('\n'),
        }
      }

      const location = findLesson(course, node.moduleId, node.lessonId)
      if (!location) return { ok: false, error: 'lesson not found' }
      if (node.kind === 'lesson') {
        return {
          ok: true,
          language: 'markdown',
          content: [
            `# ${location.lesson.title}`,
            `Course: ${course.title}`,
            `Module: ${location.module.title}`,
            `Status: ${location.lesson.generationStatus}`,
            `Estimated time: ${location.lesson.estimatedMinutes} minutes`,
            `Progress: ${course.progress[location.lesson.id]?.status ?? 'not-started'}`,
            '',
            location.lesson.summary,
            '',
            'Objectives:',
            ...location.lesson.objectives.map((objective) => `- ${objective.text}`),
            '',
            'Steps:',
            ...location.lesson.steps.map(
              (step) => `- ${stepStage(step)} — ${stepTitle(step)} (${step.id})`,
            ),
          ].join('\n'),
        }
      }
      const step = location.lesson.steps.find((item) => item.id === node.stepId)
      return step
        ? {
            ok: true,
            language: 'markdown',
            content: [
              stepMarkdown(step),
              '',
              'Learner evidence:',
              JSON.stringify(course.assessments?.[step.id] ?? null),
            ].join('\n'),
          }
        : { ok: false, error: 'step not found' }
    },
  }
}
