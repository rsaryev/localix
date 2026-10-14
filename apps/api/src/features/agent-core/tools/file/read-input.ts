import { z } from 'zod'
import { stringToArray, stringToInteger } from '../tool-schema'

/**
 * `limit` is the line-count shape Claude Code's read tool taught models (`offset`/`limit`);
 * a model that brings it here used to be refused for an unknown property.
 * It folds into the start/end pair the rest of the tool reads, so the range logic has one shape.
 */
export function withLineLimit<T extends { start_line?: number; end_line?: number; limit?: number }>(
  input: T,
): T {
  if (input.limit == null) return input
  const start = input.start_line ?? 1
  return { ...input, start_line: start, end_line: input.end_line ?? start + input.limit - 1 }
}

const lineNumber = z.preprocess(stringToInteger, z.number().int().min(1))

/**
 * One entry of a batched read. A bare string is taken as `{ path }` and a JSON-array literal as
 * the array it spells: both can only mean one thing, and refusing them costs a round-trip.
 */
function toReadItems(value: unknown): unknown {
  const list = stringToArray(value)
  return Array.isArray(list)
    ? list.map((item) => (typeof item === 'string' ? { path: item } : item))
    : list
}

export const readToolInputSchema = z.object({
  path: z.string().min(1).optional().describe('File or directory, absolute or relative to cwd.'),
  // Per-item ranges only: `mode`, `cwd`, `pages` and `sheet` apply to every item, so the item
  // stays three fields and the schema stays inside the default-roster budget.
  reads: z
    .preprocess(
      toReadItems,
      z.array(
        z.object({
          path: z.string().min(1),
          start_line: lineNumber.optional(),
          end_line: lineNumber.optional(),
        }),
      ),
    )
    .optional()
    .describe('Several files in ONE call, each with an optional line range.'),
  cwd: z.string().optional().describe('Base for relative paths (defaults to the session root).'),
  mode: z
    .enum(['content', 'outline'])
    .optional()
    .describe(
      "'outline': the symbol outline with line spans — the cheap first look at a big file.",
    ),
  offset: z
    // Same tolerance as `start_line`/`end_line` two fields down. `offset` is the field a model is
    // MOST likely to send as a string: its own description says to reuse "the offset suggested in a
    // previous truncated read", i.e. copy a number out of a text marker. Two fields in one schema
    // behaving differently for the same input is the defect.
    .preprocess(stringToInteger, z.number().int().min(0))
    .optional()
    .describe('Byte offset to continue a truncated read (use the suggested value).'),
  start_line: lineNumber
    .optional()
    .describe('1-based first line of a range, e.g. from `search`. Ignores `offset`.'),
  end_line: lineNumber.optional().describe('Inclusive last line (default: end of file).'),
  limit: z
    .preprocess(stringToInteger, z.number().int().min(1))
    .optional()
    .describe('Lines to return from start_line.'),
  pages: z
    .string()
    .optional()
    .describe('PDF pages or PPTX slides to extract, 1-based: "3", "1-5" or "10-".'),
  sheet: z.string().optional().describe('Spreadsheet sheet to extract, by name.'),
})
