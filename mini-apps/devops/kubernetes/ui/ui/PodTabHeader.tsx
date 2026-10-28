import { ChevronDown, Trash2, TerminalSquare, Share2 } from 'lucide-react'
import type { KubePod, PodUsage } from '../../backend/contracts'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { RefreshAction } from '@localixai/kit/refresh-action'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@localixai/mini-app-sdk/ui/segmented-control'
import { StatusDot } from '@localixai/kit/status-dot'
import { podDotClass } from '../model/groupPods'
import { containerUsageLines, formatUsagePair } from '../model/usage'
import { containerLabel, podContainerOptions } from '../model/podContainers'
import type { PodTabView } from '../model/podTabView'

/** The pod tab's header row: status dot + pod identity, container selector (logs
 *  view, multi-container pods), the Logs|Describe|Events|Manifest switch, and the
 *  Exec / Forward / Delete / Refresh actions. Stateless — the tab owns every piece of state,
 *  including the delete confirmation, which is the app's `ConfirmDialog` rather than the pair of
 *  inline buttons that used to swap into this row. */
export function PodTabHeader({
  pod,
  podName,
  usage,
  namespace,
  context,
  view,
  setView,
  container,
  setContainer,
  running,
  busy,
  onDeleteRequest,
  onExec,
  onForward,
  onRefresh,
}: {
  pod: KubePod | null
  podName: string
  /** Live usage for this pod; absent when the cluster serves no metrics API. */
  usage?: PodUsage
  namespace: string
  context?: string
  view: PodTabView
  setView: (view: PodTabView) => void
  container: string
  setContainer: (container: string) => void
  running: boolean
  busy: boolean
  /** Raise the delete confirmation. The tab owns the dialog and the act behind it. */
  onDeleteRequest: () => void
  onExec: () => void
  onForward: () => void
  onRefresh: () => void
}) {
  // Includes init containers and the all-containers entry, so the selector appears for a
  // one-app-container pod that has an init container — the `Init:0/1` case.
  const containerOptions = podContainerOptions(pod)
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border-soft px-3 py-2">
      <StatusDot size="lg" className={pod ? podDotClass(pod) : 'bg-text-faint'} />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{podName}</span>
        <span className="truncate text-2xs text-text-faint">
          {namespace}
          {context ? ` · ${context}` : ''}
          {usage && (
            // The per-container breakdown lives in the tooltip: the summed figure answers
            // "how big is this pod", the breakdown answers "which container is the cost".
            <span
              className="ml-1.5 tabular-nums text-text-soft"
              title={['Live usage', ...containerUsageLines(usage)].join('\n')}
            >
              · {formatUsagePair(usage.cpuNanos, usage.memoryBytes)}
            </span>
          )}
        </span>
      </div>
      <div className="ml-auto flex items-center gap-1 @max-sm:ml-0 @max-sm:w-full @max-sm:flex-wrap">
        {view === 'logs' && containerOptions.length > 0 && (
          // A quiet menu, not a framed `Select`: which container's logs to read is secondary
          // navigation in a header, and a form field there out-shouted the pod it belongs to.
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Container: ${containerLabel(container)}. Change`}
                className="min-w-0 font-normal text-text-soft"
              >
                <span className="max-w-40 truncate">
                  {containerOptions.find((option) => option.value === container)?.label ??
                    containerLabel(container)}
                </span>
                <ChevronDown data-icon="inline-end" className="opacity-60" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <MenuEntries
                family="dropdown"
                entries={containerOptions.map((option) => ({
                  id: option.value,
                  label: option.label,
                  selected: option.value === container,
                  onSelect: () => setContainer(option.value),
                }))}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <SegmentedControl aria-label="View">
          <SegmentedControlItem active={view === 'logs'} onClick={() => setView('logs')}>
            Logs
          </SegmentedControlItem>
          <SegmentedControlItem active={view === 'describe'} onClick={() => setView('describe')}>
            Describe
          </SegmentedControlItem>
          <SegmentedControlItem active={view === 'events'} onClick={() => setView('events')}>
            Events
          </SegmentedControlItem>
          <SegmentedControlItem active={view === 'manifest'} onClick={() => setView('manifest')}>
            Manifest
          </SegmentedControlItem>
        </SegmentedControl>
        {running && (
          <>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Exec into pod"
              title="Exec into pod"
              onClick={onExec}
            >
              <TerminalSquare className="size-3" />
              <span className="@max-sm:sr-only">Exec</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Forward a pod port"
              title="Forward a port"
              onClick={onForward}
            >
              <Share2 className="size-3" />
              <span className="@max-sm:sr-only">Forward</span>
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-label="Delete pod"
          title="Delete pod"
          disabled={!pod || busy}
          onClick={onDeleteRequest}
        >
          <Trash2 className="size-3" />
          <span className="@max-sm:sr-only">Delete</span>
        </Button>
        <RefreshAction aria-label="Refresh" tooltip="Refresh" onClick={onRefresh} />
      </div>
    </div>
  )
}
