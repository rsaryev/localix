import { FileText, Image as ImageIcon, PanelRight } from 'lucide-react'
import type { ToolCallItem } from '@localixai/agent/agents'
import { inspector } from '@/shared/lib/inspectorBus'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { CodePreview } from '@/shared/ui/code-block/CodePreview'
import { languageFromPath } from '@/shared/ui/code-editor/language'
import { ToolLine } from '../ToolLine'
import { ErrorRow, IORow, ToolBody, FileLink, ToolHeaderAction } from '../ToolIO'
import { ToolImages } from '../ToolImages'
import {
  isItemStreaming,
  hasItemError,
  isItemDeclined,
  itemErrorHeadline,
  itemErrorMessage,
} from '../itemHelpers'
import { asRecord, baseName, formatBytes, numField, strField } from './format'
import { ReadBatchCard, readBatchRows } from './ReadBatchCard'
import { readInputPaths } from './batchInput'

/**
 * Rich card for the `read` tool — file name, size, syntax-highlighted preview, and the picture
 * when the file was an image.
 */
export function ReadCard({ item }: { item: ToolCallItem }) {
  // Several files in one call (`reads`): the result says so once it lands (a batch that collapsed
  // to one distinct file answers as a single read); until then the input does.
  const batch = item.output
    ? readBatchRows(item.output) !== undefined
    : readInputPaths(item.input).length > 1
  return batch ? <ReadBatchCard item={item} /> : <SingleReadCard item={item} />
}

function SingleReadCard({ item }: { item: ToolCallItem }) {
  // The transcript's chat read the file, so "Open" opens it in that chat's workspace.
  const sessionId = useWorkItemSessionId()
  const input = asRecord(item.input)
  const details = asRecord(item.output)
  const streaming = isItemStreaming(item)
  const hasError = hasItemError(item)
  const errorMessage = itemErrorMessage(item)

  const filePath = strField(details, 'path') ?? strField(input, 'path') ?? ''
  // When the agent read a line range, open at that line rather than the top.
  const startLine = numField(input, 'start_line')
  const endLine = numField(input, 'end_line')
  const offset = numField(input, 'offset')
  const bytes = numField(details, 'bytes')
  const truncated = details?.truncated === true
  const isImage = details?.kind === 'image'
  const width = numField(details, 'width')
  const height = numField(details, 'height')
  const imageLabel = width && height ? `Image ${width}×${height}` : 'Image'
  const output = strField(details, 'output') ?? item.resultText

  // Surface WHICH slice was read: without this, two ranged reads of the same
  // file render as identical cards and look like the agent re-reading a file
  // it already has (it isn't — the windows are different).
  const range =
    strField(input, 'mode') === 'outline'
      ? 'outline'
      : startLine !== undefined
        ? `L${startLine}–${endLine ?? 'end'}`
        : offset !== undefined
          ? `from byte ${offset}`
          : undefined

  const title = filePath ? baseName(filePath) : 'read'
  const sizePart =
    bytes !== undefined ? `${formatBytes(bytes)}${truncated ? ' · truncated' : ''}` : undefined
  const subtitle = streaming
    ? range
      ? `Reading ${range}…`
      : 'Reading…'
    : hasError || isItemDeclined(item)
      ? // "Not found" was asserted for EVERY read failure — a permission denial and an
        // undecodable file both read as a missing file. Say what actually happened.
        (itemErrorHeadline(item) ?? 'Could not be read')
      : [isImage ? imageLabel : range, sizePart].filter(Boolean).join(' · ') || undefined

  return (
    <ToolLine
      icon={isImage ? ImageIcon : FileText}
      title={title}
      titleDetails={filePath || undefined}
      subtitle={subtitle}
      isLoading={streaming}
      hasError={hasError}
      isDismissed={isItemDeclined(item)}
      headerActions={
        filePath && !hasError && sessionId ? (
          <ToolHeaderAction
            icon={PanelRight}
            label="Open"
            onClick={() => inspector.openFile({ sessionId, path: filePath, line: startLine })}
          />
        ) : undefined
      }
    >
      <ToolBody>
        {filePath && (
          <IORow label="IN">
            <FileLink path={filePath} line={startLine} />
          </IORow>
        )}
        {output && (
          <IORow label="OUT">
            <CodePreview code={output} language={languageFromPath(filePath)} />
          </IORow>
        )}
        <ToolImages item={item} />
        <ErrorRow message={errorMessage} />
      </ToolBody>
    </ToolLine>
  )
}
