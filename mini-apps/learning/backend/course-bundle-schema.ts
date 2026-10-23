import { z } from 'zod'

const id = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120)
const text = z.string().trim().min(1).max(2_000)
const fileRef = z.string().trim().min(1).max(500)
const objective = z.object({ id, text: text.max(240) })

export const courseManifest = z.object({
  schemaVersion: z.literal(1),
  id,
  title: text.max(240),
  topic: text.max(240),
  goal: text,
  description: text,
  level: z.enum(['beginner', 'intermediate', 'advanced']),
  language: z.string().trim().min(2).max(40),
  estimatedMinutes: z.number().int().min(5).max(100_000),
  modules: z.array(fileRef).min(1).max(32),
})

export const moduleManifest = z.object({
  id,
  title: text.max(240),
  description: text,
  lessons: z.array(fileRef).min(1).max(32),
})

export const lessonManifest = z.object({
  id,
  title: text.max(240),
  summary: text,
  estimatedMinutes: z.number().int().min(1).max(480),
  generationStatus: z.enum(['pending', 'ready']),
  objectives: z.array(objective).max(12).default([]),
  steps: z.array(fileRef).max(32).default([]),
})

const conceptStep = z.object({
  id,
  type: z.literal('concept'),
  title: text.max(240),
  content: fileRef,
  keyPoints: z.array(text.max(240)).max(12).optional(),
})
const codeStep = z.object({
  id,
  type: z.literal('code'),
  title: text.max(240),
  language: z.string().trim().min(1).max(40),
  source: fileRef,
  content: fileRef.optional(),
})
const quizStep = z.object({
  id,
  type: z.literal('quiz'),
  question: text.max(500),
  options: z
    .array(z.object({ id, label: text.max(500) }))
    .min(2)
    .max(8),
  correctOptionId: id,
  explanation: fileRef,
})
const flashcardsStep = z.object({
  id,
  type: z.literal('flashcards'),
  title: text.max(240),
  cards: z
    .array(z.object({ front: text.max(600), back: text.max(1_200) }))
    .min(1)
    .max(20),
})
const walkthroughStep = z.object({
  id,
  type: z.literal('walkthrough'),
  title: text.max(240),
  steps: z
    .array(z.object({ label: text.max(240), detail: text }))
    .min(2)
    .max(20),
})
const practiceStep = z.object({
  id,
  type: z.literal('practice'),
  title: text.max(240),
  prompt: fileRef,
  acceptanceCriteria: z.array(text.max(240)).min(1).max(12),
  hint: fileRef.optional(),
})
export const stepManifest = z.discriminatedUnion('type', [
  conceptStep,
  codeStep,
  quizStep,
  flashcardsStep,
  walkthroughStep,
  practiceStep,
])
