import type { ReactNode } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { LogLine, LogSeverity, LogTokenKind } from './model/logLines'

/** Matches the viewport's top inset: rows are shifted down so line 1 clears the toolbar seam. */
const TOP_INSET_PX = 4

const SEVERITY_ROW: Record<LogSeverity, string> = {
  error: 'border-l-status-error bg-status-error/5',
  warning: 'border-l-status-warning bg-status-warning/5',
  info: 'border-l-status-info/50',
  debug: 'border-l-text-faint/40 text-text-faint',
  plain: 'border-l-transparent',
}

// Every entry is a real colour token. `--accent-foreground`, not `--accent`, for the two that used
// it: `--accent` is a FILL token — a 6% foreground veil under the glass theme — so those log
// tokens rendered as invisible text while every sibling kind stayed legible.
const TOKEN_CLASS: Record<LogTokenKind, string> = {
  plain: '',
  key: 'text-status-info',
  string: 'text-status-success',
  number: 'text-status-info',
  boolean: 'text-accent-foreground',
  null: 'text-text-faint italic',
  error: 'font-medium text-status-error',
  warning: 'font-medium text-status-warning',
  info: 'font-medium text-status-info',
  debug: 'text-text-faint',
  method: 'font-medium text-accent-foreground',
  'status-success': 'text-status-success',
  'status-warning': 'text-status-warning',
  'status-error': 'text-status-error',
}

function highlighted(text: string, query: string): ReactNode {
  const needle = query.trim()
  if (!needle) return text
  const lowerText = text.toLocaleLowerCase()
  const lowerNeedle = needle.toLocaleLowerCase()
  const parts: ReactNode[] = []
  let from = 0
  let match = lowerText.indexOf(lowerNeedle)
  while (match >= 0) {
    if (match > from) parts.push(text.slice(from, match))
    parts.push(
      <mark
        key={`${match}:${parts.length}`}
        className="rounded-sm bg-status-warning/25 text-foreground"
      >
        {text.slice(match, match + needle.length)}
      </mark>,
    )
    from = match + needle.length
    match = lowerText.indexOf(lowerNeedle, from)
  }
  if (from < text.length) parts.push(text.slice(from))
  return parts
}

export function LiveLogRow({
  index,
  line,
  measureElement,
  query,
  start,
  wrap,
}: {
  index: number
  line: LogLine
  measureElement: (node: HTMLDivElement | null) => void
  query: string
  start: number
  wrap: boolean
}) {
  return (
    <div
      ref={measureElement}
      data-index={index}
      style={{ transform: `translateY(${start + TOP_INSET_PX}px)` }}
      className={cn(
        // px-2.5 plus the 2px severity rail lands the line content on the pane's
        // px-3 seam, so rows align with the toolbar above them.
        'absolute left-0 top-0 grid grid-cols-[3rem_6.75rem_minmax(0,1fr)] border-l-2 px-2.5 py-px hover:bg-surface-hover/60',
        wrap ? 'w-full min-w-0' : 'w-max min-w-full',
        SEVERITY_ROW[line.severity],
      )}
    >
      <span aria-hidden className="select-none pr-2 text-right tabular-nums text-text-faint/65">
        {line.index}
      </span>
      <time
        dateTime={line.timestamp}
        title={line.timestamp}
        className="select-none pr-3 tabular-nums text-text-faint"
      >
        {line.timeLabel ?? '·'}
      </time>
      <span
        className={cn(
          'min-w-0 text-text-soft',
          wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre',
        )}
      >
        {query.trim()
          ? highlighted(line.display, query)
          : line.tokens.map((part) => (
              <span key={part.key} className={TOKEN_CLASS[part.kind]}>
                {part.text}
              </span>
            ))}
      </span>
    </div>
  )
}
