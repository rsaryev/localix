/**
 * The `codemode` call in the transcript: the script, then one numbered row per call it made — the
 * tool, what it was about (its files, its command), how it ended and how long it took — then what
 * the script reported, which is all the agent read. The calls' own results stayed in the script.
 */
import { useMemo } from 'react'
import { SquareCode } from 'lucide-react'
import type { ToolCallItem } from '@localixai/agent/agents'
import { formatDuration } from '@localixai/plugin-sdk/ui/utilities'

import { CodePreview } from '@/shared/ui/code-block/CodePreview'
import { ToolLine } from '../ToolLine'
import { ErrorRow, FileLink, IORow, OutputBlock, ToolBody } from '../ToolIO'
import { ToolImages } from '../ToolImages'
import {
  hasItemError,
  isItemDeclined,
  isItemStreaming,
  itemErrorHeadline,
  itemErrorMessage,
} from '../itemHelpers'
import {
  codemodeCallTarget,
  codemodeOutput,
  codemodeShape,
  codemodeSubtitle,
  codemodeTitle,
  type CodemodeCall,
  type CodemodeCallStatus,
} from './codemodeFormat'
import { toolMeta } from './meta'

const STATUS_LABEL: Partial<Record<CodemodeCallStatus, string>> = {
  running: 'running',
  error: 'failed',
  cancelled: 'cancelled',
}

const STATUS_TONE: Partial<Record<CodemodeCallStatus, string>> = {
  running: 'text-text-faint',
  error: 'text-status-error',
  cancelled: 'text-text-faint',
}

function CallTarget({ call }: { call: CodemodeCall }) {
  const target = codemodeCallTarget(call)
  if (!target) return null
  if ('command' in target)
    return (
      <span className="min-w-0 truncate font-mono text-text-faint" title={target.command}>
        {target.command}
      </span>
    )
  const [first, ...rest] = target.paths
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="min-w-0">
        <FileLink path={first!} />
      </span>
      {rest.length > 0 && (
        <span className="shrink-0 text-text-faint" title={rest.join('\n')}>
          +{rest.length}
        </span>
      )}
    </span>
  )
}

function CallRow({ call, index }: { call: CodemodeCall; index: number }) {
  const Icon = toolMeta(call.name).icon
  const status = STATUS_LABEL[call.status]
  return (
    <IORow label={String(index + 1)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5 text-2xs leading-5">
          <Icon aria-hidden className="size-3 shrink-0 text-text-faint" />
          <span className="shrink-0 font-mono text-text-soft">{call.name}</span>
          <CallTarget call={call} />
          {status && <span className={`shrink-0 ${STATUS_TONE[call.status]}`}>{status}</span>}
          {call.durationMs !== undefined && (
            <span className="ml-auto shrink-0 pl-2 tabular-nums text-text-faint">
              {formatDuration(call.durationMs)}
            </span>
          )}
        </div>
        {call.error && (
          <span className="line-clamp-3 whitespace-pre-wrap break-words text-2xs text-status-error">
            {call.error}
          </span>
        )}
      </div>
    </IORow>
  )
}

export function CodemodeCard({ item }: { item: ToolCallItem }) {
  const shape = codemodeShape(item)
  const streaming = isItemStreaming(item)
  const hasError = hasItemError(item)
  // The report can be megabytes of JSON; parse and indent it once per result, not per render.
  const report = useMemo(
    () => (item.resultText ? codemodeOutput(item.resultText) : undefined),
    [item.resultText],
  )
  return (
    <ToolLine
      icon={SquareCode}
      title={codemodeTitle(shape)}
      subtitle={
        streaming ? 'Running a script…' : (itemErrorHeadline(item) ?? codemodeSubtitle(shape))
      }
      isLoading={streaming}
      hasError={hasError}
      isDismissed={isItemDeclined(item)}
      autoOpen={hasError}
    >
      <ToolBody>
        {shape.code && (
          <IORow label="IN">
            <CodePreview
              code={shape.code}
              language="javascript"
              maxHeightClass="max-h-64"
              className="text-text-faint"
            />
          </IORow>
        )}
        {shape.calls.map((call, index) => (
          <CallRow key={index} call={call} index={index} />
        ))}
        {report && !hasError && (
          <IORow label="OUT">
            <OutputBlock linkify>{report}</OutputBlock>
          </IORow>
        )}
        <ToolImages item={item} />
        <ErrorRow message={itemErrorMessage(item)} />
      </ToolBody>
    </ToolLine>
  )
}
