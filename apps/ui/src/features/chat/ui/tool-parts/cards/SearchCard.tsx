import { Search, History, type LucideIcon } from 'lucide-react'
import type { ToolCallItem } from '@localixai/agent/agents'
import { ToolLine } from '../ToolLine'
import { ErrorRow, IORow, ToolBody, OutputBlock } from '../ToolIO'
import { isItemStreaming, hasItemError, itemErrorMessage } from '../itemHelpers'
import { asRecord, countNonEmptyLines, strField } from './format'
import { searchInputQueries } from './batchInput'

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
        <IORow label="IN">
          <span className="font-mono text-2xs text-text-faint">{inText}</span>
        </IORow>
        {output ? (
          <IORow label="OUT">
            <OutputBlock linkify>{output}</OutputBlock>
          </IORow>
        ) : (
          !streaming &&
          !errorMessage && (
            <IORow label="OUT">
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
          <IORow label="IN">
            <span className="font-mono text-2xs text-text-faint">{glob}</span>
          </IORow>
        )}
        {rows.map((row, index) => (
          <IORow key={`${row.query}:${index}`} label={String(index + 1)}>
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

/** Rich card for the `search` tool — query + glob, match-line count, output block. */
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

/** Rich card for the `history_search` tool — query + result count from resultText. */
export function HistorySearchCard({ item }: { item: ToolCallItem }) {
  const input = asRecord(item.input)
  const streaming = isItemStreaming(item)
  const hasError = hasItemError(item)

  const query = strField(input, 'query') ?? 'search'
  const output = (item.resultText ?? '').trim() ? item.resultText! : ''
  const count = countNonEmptyLines(output)

  const subtitle = streaming
    ? 'Searching history…'
    : hasError
      ? 'Failed'
      : output
        ? `${count} result${count === 1 ? '' : 's'}`
        : 'No matches'

  return (
    <SearchLikeCard
      item={item}
      icon={History}
      query={query}
      inText={query}
      subtitle={subtitle}
      output={output || undefined}
    />
  )
}
