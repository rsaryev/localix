import { Files } from 'lucide-react'
import type { ToolCallItem } from '@localixai/agent/agents'
import { CodePreview } from '@/shared/ui/code-block/CodePreview'
import { languageFromPath } from '@/shared/ui/code-editor/language'
import { ToolLine } from '../ToolLine'
import { ErrorRow, IORow, ToolBody, FileLink } from '../ToolIO'
import { ToolImages } from '../ToolImages'
import { isItemStreaming, hasItemError, isItemDeclined, itemErrorMessage } from '../itemHelpers'
import { asRecord, baseName, formatBytes, numField, strField } from './format'
import { readInputPaths } from './batchInput'

/** One file of a batched read, as `details.items` carries it (see the API's `ReadItemDetails`). */
export interface ReadBatchRow {
  path: string
  range?: string
  bytes: number
  truncated: boolean
  output: string
  kind?: 'image' | 'notebook'
  width?: number
  height?: number
  isError?: boolean
  skipped?: boolean
}

/** The rows of a finished batched read, or undefined for a single read. */
export function readBatchRows(details: unknown): ReadBatchRow[] | undefined {
  const items = asRecord(details)?.items
  if (!Array.isArray(items)) return undefined
  return items.flatMap((raw): ReadBatchRow[] => {
    const row = asRecord(raw)
    const path = strField(row, 'path')
    if (!row || !path) return []
    return [
      {
        path,
        range: strField(row, 'range'),
        bytes: numField(row, 'bytes') ?? 0,
        truncated: row.truncated === true,
        output: strField(row, 'output') ?? '',
        kind: row.kind === 'image' || row.kind === 'notebook' ? row.kind : undefined,
        width: numField(row, 'width'),
        height: numField(row, 'height'),
        isError: row.isError === true,
        skipped: row.skipped === true,
      },
    ]
  })
}

/** The meta line beside a row's path: its window, its size or what became of it. */
export function readRowMeta(row: ReadBatchRow): string {
  if (row.skipped) return 'not shown · over this call’s budget'
  if (row.isError) return 'could not be read'
  const what =
    row.kind === 'image'
      ? row.width && row.height
        ? `Image ${row.width}×${row.height}`
        : 'Image'
      : row.range
  const size = `${formatBytes(row.bytes)}${row.truncated ? ' · truncated' : ''}`
  return [what, size].filter(Boolean).join(' · ')
}

/** "L10-40" → 10, so the file opens at the slice that was read. */
function rangeStart(range: string | undefined): number | undefined {
  const match = range ? /^L(\d+)/.exec(range) : null
  return match ? Number(match[1]) : undefined
}

/**
 * Card for a `read` of several files (`reads`): one row per file — its path (openable), what
 * was read and its size, the text it returned, or why it was not. While the call streams, the
 * rows are the files the input names so far.
 */
export function ReadBatchCard({ item }: { item: ToolCallItem }) {
  const streaming = isItemStreaming(item)
  const hasError = hasItemError(item)
  const rows: ReadBatchRow[] =
    readBatchRows(item.output) ??
    readInputPaths(item.input).map((path) => ({ path, bytes: 0, truncated: false, output: '' }))

  const failed = rows.filter((row) => row.isError).length
  const skipped = rows.filter((row) => row.skipped).length
  const bytes = rows.reduce((sum, row) => sum + row.bytes, 0)
  const count = `${rows.length} file${rows.length === 1 ? '' : 's'}`
  const subtitle = streaming
    ? `Reading ${count}…`
    : [
        bytes > 0 ? formatBytes(bytes) : undefined,
        failed > 0 ? `${failed} failed` : undefined,
        skipped > 0 ? `${skipped} not shown` : undefined,
      ]
        .filter(Boolean)
        .join(' · ') || undefined

  return (
    <ToolLine
      icon={Files}
      title={`${count} · ${rows
        .slice(0, 3)
        .map((row) => baseName(row.path))
        .join(', ')}${rows.length > 3 ? ` +${rows.length - 3}` : ''}`}
      titleDetails={rows.map((row) => row.path).join('\n')}
      subtitle={subtitle}
      isLoading={streaming}
      hasError={hasError}
      isDismissed={isItemDeclined(item)}
    >
      <ToolBody>
        {rows.map((row, index) => (
          <IORow key={`${row.path}:${row.range ?? ''}:${index}`} label={String(index + 1)}>
            <div className="flex min-w-0 flex-col gap-1">
              <FileLink path={row.path} line={rangeStart(row.range)} />
              {!streaming && (
                <span
                  className={`text-2xs ${row.isError ? 'text-status-error' : 'text-text-faint'}`}
                >
                  {readRowMeta(row)}
                </span>
              )}
              {row.output && !row.skipped && row.kind !== 'image' && !row.isError && (
                <CodePreview
                  code={row.output}
                  language={languageFromPath(row.path)}
                  maxHeightClass="max-h-48"
                />
              )}
              {row.isError && row.output && (
                <span className="text-2xs text-text-faint">{row.output}</span>
              )}
            </div>
          </IORow>
        ))}
        <ToolImages item={item} />
        <ErrorRow message={itemErrorMessage(item)} />
      </ToolBody>
    </ToolLine>
  )
}
