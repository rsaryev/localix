/**
 * `search` with several patterns (`queries`): one call instead of a round-trip per pattern.
 *
 * Each query runs the whole single-search pipeline (glob widening, literal retry, grouping),
 * concurrently and bounded, so its answer and its caps are exactly what it would get alone.
 * Running them as one ripgrep with several `-e` would be one process, but it merges the hits:
 * the model could no longer tell which pattern found what, and an empty pattern would lose its
 * own retries. Results are grouped per query, inside a query budget and a text budget; a query
 * past either is named back to run alone.
 */
import { formatSize } from '@localixai/agent'
import type { AgentSource, AgentToolResult } from '@localixai/agent/agents'
import { mapLimit } from '../../../../lib/map-limit'
import type { SearchQueryDetails, SearchToolDetails } from './search-contracts'

/** Most queries one call runs. */
export const MAX_SEARCH_QUERIES = 8
/** Searches in flight at once: each is a ripgrep process walking the tree. */
export const SEARCH_BATCH_CONCURRENCY = 4
/** Model-facing text of one batch: four full single-search answers. */
export const MAX_BATCH_SEARCH_BYTES = 64_000

/** The patterns one call asks for: `query` first, then `queries`, trimmed and de-duplicated. */
export function searchQueries(input: { query?: string; queries?: string[] }): string[] {
  const all = [input.query, ...(input.queries ?? [])]
    .map((query) => query?.trim() ?? '')
    .filter(Boolean)
  return [...new Set(all)]
}

type SearchOne = (query: string) => Promise<AgentToolResult<SearchToolDetails>>

export async function runSearchBatch(
  queries: string[],
  searchOne: SearchOne,
): Promise<AgentToolResult<SearchToolDetails>> {
  const accepted = queries.slice(0, MAX_SEARCH_QUERIES)
  const results = await mapLimit(accepted, SEARCH_BATCH_CONCURRENCY, async (query) => {
    try {
      return { query, result: await searchOne(query) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        query,
        result: { content: `Failed to run search: ${message}`, isError: true },
      }
    }
  })

  const sections: string[] = []
  const rows: SearchQueryDetails[] = []
  const sources: AgentSource[] = []
  const skipped = queries.slice(MAX_SEARCH_QUERIES)
  let textBytes = 0
  let failures = 0

  for (const { query, result } of results) {
    const text = typeof result.content === 'string' ? result.content : ''
    const section = `### "${query}"\n${text}`
    const sectionBytes = Buffer.byteLength(section)
    const own = result.details
    const base = { query, cwd: own?.cwd ?? '', ...(own?.glob ? { glob: own.glob } : {}) }
    if (sections.length > 0 && textBytes + sectionBytes > MAX_BATCH_SEARCH_BYTES) {
      skipped.push(query)
      rows.push({ ...base, bytes: 0, truncated: false, output: '', skipped: true })
      continue
    }
    textBytes += sectionBytes
    sections.push(section)
    sources.push(...(result.sources ?? []))
    if (result.isError) failures += 1
    rows.push({
      ...base,
      bytes: own?.bytes ?? 0,
      truncated: own?.truncated ?? false,
      // An error has no details of its own; the card shows the message in its place.
      output: own?.output ?? (result.isError ? text : ''),
      ...(result.isError ? { isError: true as const } : {}),
    })
  }

  if (skipped.length > 0) {
    const names = skipped.map((query) => `"${query}"`).join(', ')
    sections.push(
      `[${skipped.length} more not shown — over this call's budget (${MAX_SEARCH_QUERIES} queries, ${formatSize(MAX_BATCH_SEARCH_BYTES)} of results). Run them separately: ${names}]`,
    )
  }

  const delivered = rows.filter((row) => !row.skipped)
  const details: SearchToolDetails = {
    query: queries.join(' | '),
    cwd: delivered[0]?.cwd ?? '',
    ...(delivered[0]?.glob ? { glob: delivered[0].glob } : {}),
    bytes: delivered.reduce((sum, row) => sum + row.bytes, 0),
    truncated: delivered.some((row) => row.truncated),
    output: '',
    queries: rows,
  }
  return {
    content: sections.join('\n\n'),
    details,
    ...(sources.length > 0 ? { sources } : {}),
    // A batch is an error only when every query in it failed.
    ...(failures > 0 && failures === delivered.length ? { isError: true as const } : {}),
  }
}
