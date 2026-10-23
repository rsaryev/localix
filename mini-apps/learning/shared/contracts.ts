export type LearningLevel = 'beginner' | 'intermediate' | 'advanced'

export interface LearningObjective {
  id: string
  text: string
}

export interface ConceptStep {
  id: string
  type: 'concept'
  title: string
  body: string
  keyPoints?: string[]
}

export interface CodeStep {
  id: string
  type: 'code'
  title: string
  language: string
  code: string
  explanation?: string
}

export interface QuizStep {
  id: string
  type: 'quiz'
  question: string
  options: Array<{ id: string; label: string }>
  correctOptionId: string
  explanation: string
}

export interface FlashcardsStep {
  id: string
  type: 'flashcards'
  title: string
  cards: Array<{ front: string; back: string }>
}

export interface WalkthroughStep {
  id: string
  type: 'walkthrough'
  title: string
  steps: Array<{ label: string; detail: string }>
}

export interface PracticeStep {
  id: string
  type: 'practice'
  title: string
  prompt: string
  acceptanceCriteria: string[]
  hint?: string
}

export type LessonStep =
  | ConceptStep
  | CodeStep
  | QuizStep
  | FlashcardsStep
  | WalkthroughStep
  | PracticeStep

export type LessonStepStage = 'theory' | 'test' | 'practice'
export type LessonGenerationStatus = 'pending' | 'ready'

export interface LessonOutline {
  id: string
  title: string
  summary: string
  estimatedMinutes: number
}

export interface Lesson extends LessonOutline {
  generationStatus: LessonGenerationStatus
  objectives: LearningObjective[]
  steps: LessonStep[]
}

export interface CourseModule {
  id: string
  title: string
  description: string
  lessons: Lesson[]
}

export type CourseOutlineLessonDraft = LessonOutline

export interface CourseOutlineModuleDraft {
  id: string
  title: string
  description: string
  lessons: CourseOutlineLessonDraft[]
}

export interface CourseOutlineDraft {
  title: string
  topic: string
  goal: string
  description: string
  level: LearningLevel
  language: string
  estimatedMinutes: number
  modules: CourseOutlineModuleDraft[]
}

export type LessonStatus = 'not-started' | 'in-progress' | 'completed'

export interface LessonProgress {
  status: LessonStatus
  attempts: number
  score?: number
  confidence?: number
  updatedAt: string
}

export interface LearningCourse extends Omit<CourseOutlineDraft, 'modules'> {
  version: 4
  id: string
  /** Owning chat session. The course is stored and resolved only inside this scope. */
  sessionId: string
  /** Canonical root manifest under the session-isolated mini app data directory. */
  bundlePath: string
  createdAt: string
  updatedAt: string
  activeLessonId: string | null
  activeStepId: string | null
  completedStepIds: string[]
  modules: CourseModule[]
  progress: Record<string, LessonProgress>
  /** Optional for courses saved before assessment tracking was introduced. */
  assessments?: Record<string, StepAssessment>
  generation?: Record<string, ModuleGeneration>
}

export interface ModuleGeneration {
  requestId: string
  status: 'queued' | 'failed'
  attempts: number
  requestedAt: string
  reason?: string
}

export interface StepAssessment {
  attempts: number
  firstCorrect?: boolean
  selectedOptionId?: string
  correct?: boolean
  response?: string
  submissionId?: string
  status?: 'submitted' | 'reviewed' | 'unreachable'
  passed?: boolean
  feedback?: string
  updatedAt: string
}

export interface StepEvidence {
  optionId?: string
  response?: string
  /** Recall cards are self-assessed; this records an explicit recall attempt. */
  recalled?: boolean
}

export interface ProgressUpdate {
  lessonId: string
  status: LessonStatus
  score?: number
  confidence?: number
}

export interface CourseResponse {
  course: LearningCourse
}

export interface CourseSummary {
  id: string
  title: string
  description: string
  sessionId: string
  level: LearningLevel
  language: string
  estimatedMinutes: number
  updatedAt: string
  completedLessons: number
  totalLessons: number
}

export interface CourseListResponse {
  courses: CourseSummary[]
}

export interface MaybeCourseResponse {
  course: LearningCourse | null
}
