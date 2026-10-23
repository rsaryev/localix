import { useEffect, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { CodePreview } from '@localixai/kit/code-block'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { IconButton } from '@localixai/kit/icon-button'
import { formatSqlTimestamp, outputEntryResultLine, type OutputEntry } from '../model/resultTabs'

/**
 * The Output tab body: a console log. Every executed statement is echoed
 * with an absolute timestamp + a readable `<db>>` prompt and the SQL **syntax-highlighted**
 * (not flat text), followed by its result line ("N rows retrieved / affected in N ms",
 * "completed in N ms", or the raw engine error). Newest entries at the bottom; the
 * container auto-scrolls to the end on a new entry.
 *
 * No "Drag to chat" grip: the log's recent entries reach the chat on their own as a live
 * facet of the console (`model/consoleContext.ts`), errors included.
 */
export function OutputLogView({ log, onClear }: { log: OutputEntry[]; onClear?: () => void }) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [log.length])

  if (log.length === 0) {
    return <EmptyHint className="text-xs">No output yet.</EmptyHint>
  }

  const entryKeyOccurrences = new Map<string, number>()
  const keyedLog = log.map((entry) => {
    const base = `${entry.at}:${entry.db ?? ''}:${entry.status}:${entry.sql.length}:${entry.sql.slice(0, 128)}:${entry.message.length}:${entry.message.slice(0, 64)}`
    const occurrence = (entryKeyOccurrences.get(base) ?? 0) + 1
    entryKeyOccurrences.set(base, occurrence)
    return { entry, key: occurrence === 1 ? base : `${base}:duplicate-${occurrence}` }
  })

  return (
    <div className="relative h-full min-h-0 overflow-auto p-2 font-mono text-xs leading-relaxed scrollbar-thin">
      {onClear && (
        <div className="sticky top-0 z-(--z-sticky) float-right">
          <IconButton
            size="xs"
            tooltip="Clear the output log"
            aria-label="Clear output"
            onClick={onClear}
          >
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      )}
      {keyedLog.map(({ entry, key }) => {
        const error = entry.status === 'error'
        const ts = formatSqlTimestamp(entry.at)
        const prompt = `${entry.db ?? 'sql'}>`
        return (
          <div key={key} className="border-b border-border-soft py-1.5 last:border-b-0">
            {/* Prompt line: timestamp + a readable <db>> prompt (not the near-invisible accent). */}
            <div className="flex items-baseline gap-1.5">
              <span className="shrink-0 tabular-nums text-text-faint">[{ts}]</span>
              <span className="shrink-0 font-semibold text-text-soft">{prompt}</span>
            </div>
            {/* Echoed statement — syntax-highlighted, theme-aware, line breaks preserved. */}
            <CodePreview
              code={entry.sql}
              bare
              className="mt-0.5 pl-[3.25rem] !text-xs"
              maxHeightClass="max-h-48"
            />
            {/* Result / error line. */}
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="shrink-0 tabular-nums text-text-faint">[{ts}]</span>
              <span
                className={cn(
                  'min-w-0 whitespace-pre-wrap break-words',
                  error ? 'text-status-error' : 'text-status-success',
                )}
              >
                {outputEntryResultLine(entry)}
              </span>
            </div>
          </div>
        )
      })}
      <div ref={endRef} />
    </div>
  )
}
