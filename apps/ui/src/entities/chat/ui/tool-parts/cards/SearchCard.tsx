import { Search, History, type LucideIcon } from 'lucide-react'
import type { ToolCallItem } from '@localixai/agent/agents'
import { ToolLine } from '../ToolLine'
import { ErrorRow, IORow, ToolBody, OutputBlock } from '../ToolIO'
import { isItemStreaming, hasItemError, itemErrorMessage } from '../itemHelpers'
import { asRecord, countNonEmptyLines, strField } from './format'
import { searchInputQueries } from './batchInput'
import { globalSearchSummary } from './globalSearchSummary'

/** Shared shell for the search-flavoured cards: backticked query title + OUT body. */
function SearchLikeCard({
  item,
  icon,
  query,
  inText,
  subtitle,
  output,
}: {
  item: ToolCallItem
  icon: LucideIcon
  query: string
  /** IN row content (query, optionally with glob). */
  inText: string
  subtitle?: string
  output?: string
}) {
  const streaming = isItemStreaming(item)
  const hasError = hasItemError(item)
  const errorMessage = itemErrorMessage(item)

  return (
    <ToolLine
      icon={icon}
      title={`\`${query}\``}
      subtitle={subtitle}
      isLoading={streaming}
      hasError={hasError}
    >
      <ToolBody>
        <IORow label="In">
          <span className="font-mono text-2xs text-text-faint">{inText}</span>
        </IORow>
        {output ? (
          <IORow label="Out">
            <OutputBlock linkify>{output}</OutputBlock>
          </IORow>
        ) : (
          !streaming &&
          !errorMessage && (
            <IORow label="Out">
              <span className="text-2xs text-text-faint">No matches</span>
            </IORow>
          )
        )}
        <ErrorRow message={errorMessage} />
      </ToolBody>
    </ToolLine>
  )
}

/** One query of a batched search, as `details.queries` carries it. */
export interface SearchBatchRow {
  query: string
  glob?: string
  output: string
  truncated: boolean
  isError: boolean
  skipped: boolean
}

/** The per-query rows of a finished batched search, or undefined for a single search. */
export function searchBatchRows(details: unknown): SearchBatchRow[] | undefined {
  const queries = asRecord(details)?.queries
  if (!Array.isArray(queries)) return undefined
  return queries.flatMap((raw): SearchBatchRow[] => {
    const row = asRecord(raw)
    const query = strField(row, 'query')
    if (!row || query === undefined) return []
    return [
      {
        query,
        glob: strField(row, 'glob'),
        output: strField(row, 'output') ?? '',
        truncated: row.truncated === true,
        isError: row.isError === true,
        skipped: row.skipped === true,
      },
    ]
  })
}

function searchRowMeta(row: SearchBatchRow): string {
  if (row.skipped) return 'not shown · over this call’s budget'
  if (row.isError) return 'failed'
  if (!row.output) return 'No matches'
  return `${countNonEmptyLines(row.output)} lines${row.truncated ? ' · truncated' : ''}`
}

/** Several patterns in one call (`queries`): one section per query — its hits, or why none. */
function SearchBatchCard({ item }: { item: ToolCallItem }) {
  const streaming = isItemStreaming(item)
  const hasError = hasItemError(item)
  const rows: SearchBatchRow[] =
    searchBatchRows(item.output) ??
    searchInputQueries(item.input).map((query) => ({
      query,
      output: '',
      truncated: false,
      isError: false,
      skipped: false,
    }))
  const glob = strField(item.input, 'glob')
  const failed = rows.filter((row) => row.isError).length
  const hits = rows.reduce((sum, row) => sum + countNonEmptyLines(row.output), 0)
  const subtitle = streaming
    ? `Searching ${rows.length} patterns…`
    : [`${hits} lines`, failed > 0 ? `${failed} failed` : undefined].filter(Boolean).join(' · ')

  return (
    <ToolLine
      icon={Search}
      title={rows.map((row) => `\`${row.query}\``).join(', ')}
      subtitle={subtitle}
      isLoading={streaming}
      hasError={hasError}
    >
      <ToolBody>
        {glob && (
          <IORow label="In">
            <span className="font-mono text-2xs text-text-faint">{glob}</span>
          </IORow>
        )}
        {rows.map((row, index) => (
          <IORow key={`${row.query}:${index}`} label={index + 1}>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate font-mono text-2xs text-text-soft">{row.query}</span>
              {!streaming && (
                <span
                  className={`text-2xs ${row.isError ? 'text-status-error' : 'text-text-faint'}`}
                >
                  {searchRowMeta(row)}
                </span>
              )}
              {row.output && !row.skipped && <OutputBlock linkify>{row.output}</OutputBlock>}
            </div>
          </IORow>
        ))}
        <ErrorRow message={itemErrorMessage(item)} />
      </ToolBody>
    </ToolLine>
  )
}

/** Rich card for the `Search` tool — query + glob, match-line count, output block. */
export function SearchCard({ item }: { item: ToolCallItem }) {
  const batch = item.output
    ? searchBatchRows(item.output) !== undefined
    : searchInputQueries(item.input).length > 1
  return batch ? <SearchBatchCard item={item} /> : <SingleSearchCard item={item} />
}

function SingleSearchCard({ item }: { item: ToolCallItem }) {
  const input = asRecord(item.input)
  const details = asRecord(item.output)
  const streaming = isItemStreaming(item)
  const hasError = hasItemError(item)

  const query = strField(details, 'query') ?? searchInputQueries(input)[0] ?? 'search'
  const glob = strField(details, 'glob') ?? strField(input, 'glob')
  const truncated = details?.truncated === true
  const output = strField(details, 'output') ?? item.resultText ?? ''

  const subtitle = streaming
    ? 'Searching…'
    : hasError
      ? 'Failed'
      : output
        ? `${countNonEmptyLines(output)} lines${truncated ? ' · truncated' : ''}`
        : 'No matches'

  return (
    <SearchLikeCard
      item={item}
      icon={Search}
      query={query}
      inText={glob ? `${query}  ${glob}` : query}
      subtitle={subtitle}
      output={output || undefined}
    />
  )
}

/**
 * Rich card for `GlobalSearch`: the query and its result count (noting a match by meaning), or
 * what conversation was read.
 */
export function GlobalSearchCard({ item }: { item: ToolCallItem }) {
  const streaming = isItemStreaming(item)
  const hasError = hasItemError(item)
  const summary = globalSearchSummary(item.input, item.resultText)
  const output = (item.resultText ?? '').trim() ? item.resultText! : ''
  const subtitle = streaming
    ? summary.mode === 'search'
      ? 'Searching…'
      : 'Reading…'
    : hasError
      ? 'Failed'
      : summary.subtitle

  return (
    <SearchLikeCard
      item={item}
      icon={summary.mode === 'search' ? Search : History}
      query={summary.title}
      inText={summary.title}
      subtitle={subtitle}
      output={output || undefined}
    />
  )
}
