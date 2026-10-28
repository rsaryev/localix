import { z } from 'zod'

import { stringToArray, stringToInteger } from '../tool-schema'

export const SEARCH_CONTEXT_MAX = 10

export const searchToolInputSchema = z.object({
  query: z
    .string()
    .optional()
    .describe('Ripgrep regex for file contents. Omit it (pass only `glob`) to list files by name.'),
  queries: z
    .preprocess(stringToArray, z.array(z.string()))
    .optional()
    .describe('Several regexes in ONE call; results come grouped per query.'),
  cwd: z.string().optional().describe('Directory to search in (defaults to the session root).'),
  glob: z.string().optional().describe('e.g. "src/**/*.ts": narrows a query, or lists files.'),
  path: z.string().optional().describe('A file or directory to search in.'),
  context: z
    .number()
    .int()
    .min(1)
    .max(SEARCH_CONTEXT_MAX)
    .optional()
    .describe('Lines around each hit (2-5 often saves a `Read`).'),
  output_mode: z
    .enum(['content', 'files_with_matches', 'count'])
    .optional()
    .describe('Default content; files_with_matches lists paths; count gives hits per file.'),
  head_limit: z.number().int().min(1).optional(),
  ignore_case: z.boolean().optional(),
  multiline: z.boolean().optional(),
  type: z.string().optional().describe('File type, e.g. "ts".'),
})

export type SearchInput = z.infer<typeof searchToolInputSchema>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** Grep's own keys: with one of them a `pattern` can only be a regex, never a Glob's pattern. */
const GREP_ONLY = [
  'output_mode',
  '-i',
  '-n',
  '-A',
  '-B',
  '-C',
  'head_limit',
  'type',
  'multiline',
  'glob',
  'context',
  'offset',
  'ignore_case',
]

/**
 * Whether a bare `pattern` is Glob's file pattern: it has a wildcard and no regex-only
 * character, and is either rooted in a directory (`src/*.ts`) or starts with `*`
 * (`*.ts`). `foo.*bar`, `TODO` and `colou?r` stay regexes, which is what Grep's pattern is.
 */
export function looksLikeGlob(pattern: string): boolean {
  if (/[\\^$()|+]/.test(pattern) || /\.[*+]/.test(pattern)) return false
  if (!pattern.includes('*')) return /\{[^}]*,[^}]*\}/.test(pattern) && pattern.includes('/')
  return pattern.includes('/') || pattern.startsWith('*')
}

const whole = (value: unknown, key: string): number => {
  const n = stringToInteger(value)
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0)
    throw new Error(`search \`${key}\` is a number of lines.`)
  return n
}

/**
 * Claude Code's Grep and Glob arguments, as this tool takes them: `pattern` is the regex (or, for
 * Glob's file pattern, `glob`), `-i` is `ignore_case`, and `-A`, `-B`, `-C` and `context` are one
 * `context` (the widest: it never shows less than asked). Grep's default output is the matching
 * FILES, so a call that uses `pattern` without an `output_mode` gets that, as Claude Code's does;
 * a call in this tool's own words keeps its lines. `-n` only toggles line numbers, which a content
 * result always has. What the tool cannot do (`offset`) or a spelling that disagrees with the
 * native one beside it is refused: the search would otherwise run as something else.
 */
function claudeCodeSearch(input: Record<string, unknown>): Record<string, unknown> {
  const claude = ['pattern', '-i', '-n', '-A', '-B', '-C', 'offset']
  if (!claude.some((key) => input[key] !== undefined) && input.head_limit !== 0) return input
  const {
    pattern,
    '-i': ignoreCase,
    '-n': _lineNumbers,
    '-A': after,
    '-B': before,
    '-C': around,
    offset,
    ...rest
  } = input
  let out: Record<string, unknown> = rest
  if (offset !== undefined && whole(offset, 'offset') > 0)
    throw new Error(
      'search has no `offset`: narrow the search with `glob`, `path` or `type`, or cap it with `head_limit`.',
    )
  if (pattern !== undefined) {
    if (typeof pattern !== 'string' || pattern === '')
      throw new Error('search `pattern` is the regex (or glob) to look for.')
    if (out.query !== undefined && out.query !== pattern)
      throw new Error('search got both `pattern` and a different `query`: pass one.')
    const glob = !GREP_ONLY.some((key) => input[key] !== undefined) && looksLikeGlob(pattern)
    if (glob && out.queries === undefined && out.query === undefined)
      out = { ...out, glob: pattern }
    else
      out = {
        ...out,
        query: pattern,
        output_mode: out.output_mode ?? 'files_with_matches',
      }
  }
  if (ignoreCase !== undefined && out.ignore_case !== undefined && ignoreCase !== out.ignore_case)
    throw new Error('search got both `-i` and a different `ignore_case`: pass one.')
  if (ignoreCase === true) out = { ...out, ignore_case: true }
  const lines = [after, before, around, out.context]
    .filter((value) => value !== undefined)
    .map((value) => whole(value, 'context'))
  const widest = Math.min(Math.max(0, ...lines), SEARCH_CONTEXT_MAX)
  if (lines.length > 0) {
    const { context: _context, ...without } = out
    out = widest > 0 ? { ...without, context: widest } : without
  }
  // Claude Code's 0 means "no limit": there is none to keep.
  if (out.head_limit !== undefined && whole(out.head_limit, 'head_limit') === 0) {
    const { head_limit: _limit, ...without } = out
    out = without
  }
  return out
}

/**
 * The runtime's pre-validation hook: it never runs the zod `preprocess`, so a bare `queries`
 * string becomes its one-element list here. A `context` above the cap is read as the cap
 * (LOCALIX-34 asked for 17 lines and lost the whole search). Claude Code's own arguments are
 * read as this tool's (`claudeCodeSearch`).
 */
export function prepareSearchArguments(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const input = claudeCodeSearch(raw)
  const queries = input.queries === undefined ? undefined : stringToArray(input.queries)
  const context =
    typeof input.context === 'number' && input.context > SEARCH_CONTEXT_MAX
      ? SEARCH_CONTEXT_MAX
      : input.context
  if (input === raw && queries === input.queries && context === input.context) return raw
  return {
    ...input,
    ...(queries !== undefined ? { queries } : {}),
    ...(context !== undefined ? { context } : {}),
  }
}
