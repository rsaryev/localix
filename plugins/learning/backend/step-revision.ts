import { createHash } from 'node:crypto'
import type { LessonStep } from '../shared/contracts'
import { taskContent } from '../shared/task-content'

/** Editing an assessed task invalidates its evidence; polishing theory does not erase mastery. */
export function stepRevision(step: LessonStep): string {
  return createHash('sha256').update(taskContent(step)).digest('hex')
}
