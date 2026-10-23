import { z } from 'zod'
import { nonnegative } from './schema'
import { formatBytes } from './system'

/** How many marks are kept; the oldest go first. */
export const SYSTEM_MARKS_LIMIT = 50
/** One limit for the route and the agent's tool, so the two can never accept different notes. */
export const SYSTEM_MARK_NOTE_MAX = 200

export const systemMarkSchema = z.object({
  id: z.string(),
  note: z.string(),
  at: z.string(),
  cpuPercent: z.number().min(0).max(100).nullable(),
  memoryUsedBytes: nonnegative,
})
export const systemMarksSchema = z.object({ marks: z.array(systemMarkSchema) })
/** What the view sends to add one. */
export const systemMarkInputSchema = z.object({
  note: z
    .string()
    .trim()
    .min(1, 'Write a note for the mark.')
    .max(SYSTEM_MARK_NOTE_MAX, `Keep the note under ${SYSTEM_MARK_NOTE_MAX} characters.`),
})

export type SystemMark = z.infer<typeof systemMarkSchema>
export type SystemMarks = z.infer<typeof systemMarksSchema>

/** The marks as the agent reads them, oldest first, each with the sample it was taken with. */
export function formatSystemMarks({ marks }: SystemMarks): string {
  if (!marks.length) return 'No marks yet.'
  return [
    'Marks (oldest first):',
    ...marks.map(
      (mark) =>
        `- ${mark.at}: "${mark.note}" — CPU ${mark.cpuPercent === null ? 'not sampled yet' : `${mark.cpuPercent.toFixed(1)}%`}, memory ${formatBytes(mark.memoryUsedBytes)} used`,
    ),
  ].join('\n')
}
