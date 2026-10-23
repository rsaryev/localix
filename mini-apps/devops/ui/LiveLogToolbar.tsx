import { useMemo, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { useProblemReport } from '@localixai/mini-app-sdk/ui'
import type { ProblemReport } from '@localixai/mini-app-sdk/ui/problems'
import { Check, Copy, Download, MoreHorizontal, TriangleAlert, WrapText } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { SearchInput } from '@localixai/kit/search-input'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { ALL_LOG_SEVERITIES, type LogSeverity } from './model/logLines'

const SEVERITY_LABEL: Record<LogSeverity, string> = {
  error: 'Errors',
  warning: 'Warnings',
  info: 'Info',
  debug: 'Debug',
  plain: 'Other',
}

export function LiveLogToolbar({
  actions,
  subject,
  contentAvailable,
  copied,
  error,
  filterActive,
  filteringSeverity,
  lineCount,
  onCopyVisible,
  onDownload,
  query,
  setQuery,
  severities,
  toggleSeverity,
  visibleCount,
  visibleTextAvailable,
  wrap,
  setWrap,
}: {
  actions?: ReactNode
  /** Whose logs these are — a container or a pod. Two open log panes are two subjects. */
  subject: string
  contentAvailable: boolean
  copied: boolean
  error?: string | null
  filterActive: boolean
  filteringSeverity: boolean
  lineCount: number
  onCopyVisible: () => void
  onDownload: () => void
  query: string
  setQuery: Dispatch<SetStateAction<string>>
  severities: readonly LogSeverity[]
  toggleSeverity: (severity: LogSeverity, checked: boolean) => void
  visibleCount: number
  visibleTextAvailable: boolean
  wrap: boolean
  setWrap: Dispatch<SetStateAction<boolean>>
}) {
  // The toolbar has room for a marker, not for a report — so the reason lives in the Event Center
  // and the marker only says the stream is behind. It used to live in a `title` tooltip, which is
  // to say nowhere.
  const report = useMemo<ProblemReport | null>(
    () =>
      error && lineCount > 0
        ? {
            subject: { label: `${subject} logs` },
            problems: [{ severity: 'warning', message: error }],
            consequence: 'stale',
          }
        : null,
    [error, lineCount, subject],
  )
  useProblemReport(report, { scope: 'devops', sourceVisible: true })
  return (
    <WorkbenchToolbar aria-label="Log controls">
      <SearchInput
        value={query}
        onValueChange={setQuery}
        aria-label="Filter logs"
        placeholder="Filter logs"
        bare
        className="min-w-0 flex-1 @sm:max-w-sm"
      />
      <span className="shrink-0 text-2xs tabular-nums text-text-faint">
        {filterActive ? `${visibleCount} / ` : ''}
        {lineCount} {lineCount === 1 ? 'line' : 'lines'}
      </span>
      {report && (
        <span className="flex shrink-0 items-center gap-1 text-2xs text-status-warning">
          <TriangleAlert className="size-3" />
          Refresh delayed
        </span>
      )}
      {actions}
      <Button
        variant={wrap ? 'secondary' : 'ghost'}
        size="icon-xs"
        aria-label={wrap ? 'Disable line wrapping' : 'Wrap long lines'}
        title={wrap ? 'Disable line wrapping' : 'Wrap long lines'}
        onClick={() => setWrap((value) => !value)}
      >
        <WrapText className="size-3" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={filteringSeverity ? 'secondary' : 'ghost'}
            size="icon-xs"
            aria-label="Log actions and severity filters"
            title="Log actions and severity filters"
          >
            <MoreHorizontal className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <MenuEntries
            family="dropdown"
            entries={[
              {
                id: 'copy',
                label: copied ? 'Copied' : 'Copy visible',
                icon: copied ? Check : Copy,
                disabled: !visibleTextAvailable,
                onSelect: onCopyVisible,
              },
              {
                id: 'download',
                label: 'Download all',
                icon: Download,
                disabled: !contentAvailable,
                onSelect: onDownload,
              },
              { separator: true },
              { header: 'Show severity' },
              // Real multi-select: each severity is shown or hidden on its own, so these are
              // `checked` toggles that keep the menu open while the person sets several.
              ...ALL_LOG_SEVERITIES.map((severity) => {
                const shown = severities.includes(severity)
                return {
                  id: `severity:${severity}`,
                  label: SEVERITY_LABEL[severity],
                  checked: shown,
                  keepOpen: true,
                  onSelect: () => toggleSeverity(severity, !shown),
                }
              }),
            ]}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </WorkbenchToolbar>
  )
}
