import { Search, History, type LucideIcon } from 'lucide-react'
import type { ToolCallItem } from '@localixai/agent/agents'
import { ToolLine } from '../ToolLine'
import { ErrorRow, IORow, ToolBody, OutputBlock } from '../ToolIO'
import { isItemStreaming, hasItemError, itemErrorMessage } from '../itemHelpers'
import { asRecord, countNonEmptyLines, strField } from './format'

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

/** Rich card for the `search` tool — query + glob, match-line count, output block. */
export function SearchCard({ item }: { item: ToolCallItem }) {
  const input = asRecord(item.input)
  const details = asRecord(item.output)
  const streaming = isItemStreaming(item)
  const hasError = hasItemError(item)

  const query = strField(details, 'query') ?? strField(input, 'query') ?? 'search'
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
