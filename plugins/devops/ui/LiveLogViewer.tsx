import type { ReactNode } from 'react'
import { LiveLogToolbar } from './LiveLogToolbar'
import { LiveLogViewport } from './LiveLogViewport'
import { useLiveLogViewerState } from './model/useLiveLogViewerState'

/**
 * Readable bounded-tail viewer shared by Docker and Kubernetes.
 *
 * `live=false` is a real frozen snapshot: the parent stops its log polling, so a
 * reader's selection and scroll position cannot move underneath them. Scrolling up
 * pauses automatically; Play resumes polling and follows the newest line.
 */
export function LiveLogViewer({
  content,
  subject,
  error,
  emptyLabel,
  ariaLabel,
  live,
  onLiveChange,
  downloadName = 'logs',
  actions,
}: {
  content: string
  /** Whose logs these are — a container or a pod. Two open log panes must not share one report. */
  subject: string
  error?: string | null
  emptyLabel: string
  ariaLabel: string
  live: boolean
  onLiveChange: (live: boolean) => void
  downloadName?: string
  actions?: ReactNode
}) {
  const state = useLiveLogViewerState(content, downloadName)

  // No ground coat: the hosting pane already paints one, and under the host's macOS glass theme
  // the ground tokens carry alpha — a second pane-sized coat compounds into an opaque slab.
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <LiveLogToolbar
        actions={actions}
        subject={subject}
        contentAvailable={Boolean(content)}
        copied={state.copied}
        error={error}
        filterActive={Boolean(state.deferredQuery.trim()) || state.filteringSeverity}
        filteringSeverity={state.filteringSeverity}
        lineCount={state.lines.length}
        onCopyVisible={() => void state.copyVisible()}
        onDownload={state.download}
        query={state.query}
        setQuery={state.setQuery}
        severities={state.severities}
        toggleSeverity={state.toggleSeverity}
        visibleCount={state.visibleLines.length}
        visibleTextAvailable={Boolean(state.visibleText)}
        wrap={state.wrap}
        setWrap={state.setWrap}
      />
      <LiveLogViewport
        ariaLabel={ariaLabel}
        emptyLabel={emptyLabel}
        error={error}
        filteringSeverity={state.filteringSeverity}
        live={live}
        onLiveChange={onLiveChange}
        query={state.deferredQuery}
        visibleLines={state.visibleLines}
        wrap={state.wrap}
      />
    </div>
  )
}
