import { useMemo, useState } from 'react'
import { CircleAlert, TriangleAlert, ChevronRight, CornerDownRight, Focus } from 'lucide-react'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { problemMenu } from './problemMenu'
import { useChatStore } from '@/entities/chat/model/store'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { useActiveFilePath } from '../model/fileNav'
import { openFileInGrid } from '@/shared/lib/recentFiles'
import { fileIcon } from '@/shared/ui/file-icon/fileIcon'
import { SearchInput } from '@localixai/kit/search-input'
import { Button } from '@localixai/kit/button'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { WorkbenchStatusBar, WorkbenchStatusItem } from '@localixai/kit/workbench-statusbar'
import { TogglePill } from '@localixai/kit/toggle-pill'
import { formatDiagnosticSource } from '@/shared/ui/code-editor/types'
import type { LspDiagnostic, LspRange } from '@/shared/api/contracts'
import { baseName, dirName } from '@localixai/mini-app-sdk/ui/utilities'
import { toggleInSet } from '@/shared/lib/toggleInSet'
import { StateNotice } from '@localixai/kit/state-notice'
import { PROBLEM_SEVERITY, type SeverityPresentation } from '@/shared/ui/problem-report'
import { QuickFixMenu } from './QuickFixMenu'
import { severityBucket, severityRank } from '../model/problemsCount'

/** LSP severity numbers over the app's ONE severity table — no second set of icons or colours. */
const SEVERITY: Record<number, SeverityPresentation> = {
  1: PROBLEM_SEVERITY.error,
  2: PROBLEM_SEVERITY.warning,
  3: PROBLEM_SEVERITY.info,
  4: { ...PROBLEM_SEVERITY.info, label: 'Hint' },
}

interface FileGroup {
  file: string
  diagnostics: LspDiagnostic[]
}

/**
 * Aggregates LSP diagnostics across every file the agent has touched this session
 * (they stream into `session.lspDiagnostics` keyed by absolute path) into one
 * click-to-jump list — the "Problems" view an agent IDE needs to verify its own
 * edits. Read-only; no backend call (the data is already in the store). Rows show
 * the `source(code)` rule id (e.g. `ts(2304)`); a header text filter + severity
 * toggles narrow a noisy list.
 */
export function ProblemsTab() {
  // The chat this Problems tab BELONGS to (its grid scope). Reading the chat on screen instead
  // made a kept-alive Problems tab of chat A list chat B's diagnostics, quick-fix against B's
  // language server and open B's files the moment the person switched chats.
  const sessionId = useWorkItemSessionId()
  const diagnosticsByFile = useChatStore((s) => {
    const sess = sessionId ? s.allSessions.find((x) => x.id === sessionId) : undefined
    return sess?.lspDiagnostics
  })
  const openFile = (path: string, range: LspRange) => {
    if (!sessionId) return
    openFileInGrid({
      sessionId,
      path,
      line: range.start.line + 1,
      column: range.start.character,
      endLine: range.end.line + 1,
      endColumn: range.end.character,
    })
  }
  // Path of the file in the focused grid group — drives the "Active file only"
  // filter. null when nothing is focused.
  const activeFilePath = useActiveFilePath()
  const [activeOnly, setActiveOnly] = useState(false)
  // Per-file collapse state (local — no store selector, no #185 risk).
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const toggleCollapsed = (file: string) => setCollapsed((cur) => toggleInSet(cur, file))
  // Filters. `query` matches message/source/code/filename; `hidden` is the set of
  // severity buckets (1 error, 2 warning, 3 info+hint) the user toggled OFF.
  const [query, setQuery] = useState('')
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set())
  const toggleSeverity = (bucket: number) => setHidden((cur) => toggleInSet(cur, bucket))
  // Server-reported project-wide totals (separate from the per-open-file diagnostics
  // above) — used to explain an empty panel when the server still reports problems.
  // Selectors return NUMBERS (stable primitives) — no fresh-ref render-loop risk.
  const serverErrors = useChatStore((s) =>
    (s.allSessions.find((x) => x.id === sessionId)?.lspServers ?? []).reduce(
      (n, v) => n + v.errorCount,
      0,
    ),
  )
  const serverWarnings = useChatStore((s) =>
    (s.allSessions.find((x) => x.id === sessionId)?.lspServers ?? []).reduce(
      (n, v) => n + v.warningCount,
      0,
    ),
  )

  // Total counts per severity bucket across ALL open-file diagnostics (drives the
  // toggle-chip badges — independent of the active filter).
  const totals = useMemo(() => {
    let errors = 0
    let warnings = 0
    let info = 0
    for (const diags of Object.values(diagnosticsByFile ?? {})) {
      for (const d of diags ?? []) {
        const b = severityBucket(d.severity)
        if (b === 1) errors++
        else if (b === 2) warnings++
        else info++
      }
    }
    return { errors, warnings, info }
  }, [diagnosticsByFile])
  const hasAny = totals.errors + totals.warnings + totals.info > 0

  const { groups, errors, warnings } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matchesText = (d: LspDiagnostic, file: string) => {
      if (!q) return true
      const code = d.code === undefined ? '' : String(d.code)
      return (
        d.message.toLowerCase().includes(q) ||
        (d.source ?? '').toLowerCase().includes(q) ||
        code.toLowerCase().includes(q) ||
        baseName(file).toLowerCase().includes(q)
      )
    }
    const groups: FileGroup[] = []
    let errors = 0
    let warnings = 0
    for (const [file, diags] of Object.entries(diagnosticsByFile ?? {})) {
      if (!diags || diags.length === 0) continue
      if (activeOnly && file !== activeFilePath) continue
      const kept = diags.filter(
        (d) => !hidden.has(severityBucket(d.severity)) && matchesText(d, file),
      )
      if (kept.length === 0) continue
      for (const d of kept) {
        if (severityRank(d.severity) === 1) errors++
        else if (severityRank(d.severity) === 2) warnings++
      }
      const sorted = [...kept].sort(
        (a, b) =>
          severityRank(a.severity) - severityRank(b.severity) ||
          a.range.start.line - b.range.start.line,
      )
      groups.push({ file, diagnostics: sorted })
    }
    groups.sort((a, b) => baseName(a.file).localeCompare(baseName(b.file)))
    return { groups, errors, warnings }
  }, [diagnosticsByFile, query, hidden, activeOnly, activeFilePath])

  // Nothing anywhere in the store — the "no problems" / "server reports N" empty state.
  if (!hasAny) {
    const serverTotal = serverErrors + serverWarnings
    return serverTotal > 0 ? (
      <StateNotice
        icon={CircleAlert}
        title="No diagnostics for open files"
        body={
          <>
            The language server reports {serverErrors} error{serverErrors === 1 ? '' : 's'}
            {serverWarnings > 0
              ? ` and ${serverWarnings} warning${serverWarnings === 1 ? '' : 's'}`
              : ''}{' '}
            across the project. This panel only shows diagnostics for files{' '}
            <strong>open in the editor</strong> — open a file to see its problems inline.
          </>
        }
      />
    ) : (
      <StateNotice
        icon={CircleAlert}
        title="No problems detected"
        body="Diagnostics from the language servers appear here as the agent opens and edits files."
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Filter bar: text search + per-severity toggle chips with live counts. */}
      <WorkbenchToolbar aria-label="Problem filters" layout="stacked">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="Filter problems…"
          size="md"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <SeverityChip
            bucket={1}
            count={totals.errors}
            hidden={hidden}
            onToggle={toggleSeverity}
          />
          <SeverityChip
            bucket={2}
            count={totals.warnings}
            hidden={hidden}
            onToggle={toggleSeverity}
          />
          <SeverityChip bucket={3} count={totals.info} hidden={hidden} onToggle={toggleSeverity} />
          <TogglePill
            active={activeOnly}
            onClick={() => setActiveOnly((v) => !v)}
            title={
              activeOnly
                ? 'Show problems from all open files'
                : 'Show problems from the active file only'
            }
            // Selected = the 11% `surface-active` veil, not `bg-surface-raised`: raised mixes from
            // a darker ground than the toolbar, so an active pill read as a black chip.
            activeClassName="border-control-border/55 bg-surface-active text-foreground"
            className="ml-auto"
          >
            <Focus className="size-3" />
            <span>Active file</span>
          </TogglePill>
          {groups.length > 1 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() =>
                setCollapsed((cur) =>
                  cur.size >= groups.length ? new Set() : new Set(groups.map((g) => g.file)),
                )
              }
              className="text-text-faint"
            >
              {collapsed.size >= groups.length ? 'Expand all' : 'Collapse all'}
            </Button>
          )}
        </div>
      </WorkbenchToolbar>

      {groups.length === 0 ? (
        <StateNotice
          title={
            activeOnly
              ? activeFilePath
                ? 'No problems in the active file'
                : 'No active file'
              : 'No matching problems'
          }
          body={
            activeOnly && !activeFilePath
              ? 'Open a file in the editor, or turn off "Active file" to see problems from every open file.'
              : 'Adjust the filter or severity toggles above.'
          }
        />
      ) : (
        <>
          <WorkbenchStatusBar aria-label="Filtered problem counts" seam="bottom">
            <WorkbenchStatusItem className="max-w-none gap-1">
              <CircleAlert className="size-3 text-status-error" />
              {errors} {errors === 1 ? 'error' : 'errors'}
            </WorkbenchStatusItem>
            <WorkbenchStatusItem className="max-w-none gap-1">
              <TriangleAlert className="size-3 text-status-warning" />
              {warnings} {warnings === 1 ? 'warning' : 'warnings'}
            </WorkbenchStatusItem>
          </WorkbenchStatusBar>
          <div className="min-h-0 flex-1 overflow-auto scrollbar-thin py-1">
            {groups.map((group) => {
              const { Icon, color } = fileIcon(baseName(group.file))
              const dir = dirName(group.file)
              const isCollapsed = collapsed.has(group.file)
              return (
                <div key={group.file} className="mb-0.5">
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(group.file)}
                    aria-expanded={!isCollapsed}
                    // `lx-occluder`, not plain `bg-background`: under glass the nested ground coat
                    // is cleared by the once-only rule, so rows bled through this sticky header;
                    // the occluder escapes it and keeps the occluding pane-hue coat.
                    className="lx-occluder sticky top-0 z-(--z-sticky) flex w-full items-center gap-1.5 px-3 py-1 text-left text-xs outline-none transition-colors focus-ring hover:bg-surface-hover"
                  >
                    <ChevronRight
                      className={`size-3 shrink-0 text-text-faint transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                    />
                    <Icon className={`size-3.5 shrink-0 ${color}`} />
                    <span className="truncate font-medium text-foreground">
                      {baseName(group.file)}
                    </span>
                    {dir && <span className="truncate text-2xs text-text-faint">{dir}</span>}
                    <span className="ml-auto shrink-0 text-2xs text-text-faint">
                      {group.diagnostics.length}
                    </span>
                  </button>
                  {!isCollapsed &&
                    group.diagnostics.map((d, i) => {
                      const sev = SEVERITY[severityRank(d.severity)] ?? SEVERITY[1]
                      const line = d.range.start.line
                      const rule = formatDiagnosticSource(d.source, d.code)
                      const related = d.relatedInformation ?? []
                      return (
                        <div key={`${group.file}:${line}:${i}`}>
                          <ContextMenu>
                            <ContextMenuTrigger asChild>
                              <div className="group flex w-full items-start pr-2 transition-colors hover:bg-surface-hover">
                                <button
                                  type="button"
                                  onClick={() => openFile(group.file, d.range)}
                                  title={`${sev.label}: ${d.message}`}
                                  className="flex min-w-0 flex-1 items-start gap-2 py-[0.2rem] pl-7 pr-1 text-left text-xs text-text-soft outline-none transition-colors focus-ring group-hover:text-foreground"
                                >
                                  <sev.Icon className={`mt-0.5 size-3.5 shrink-0 ${sev.color}`} />
                                  <span className="min-w-0 flex-1 truncate">{d.message}</span>
                                  {rule && (
                                    <span className="shrink-0 tabular-nums text-2xs text-text-faint">
                                      {rule}
                                    </span>
                                  )}
                                  <span className="shrink-0 tabular-nums text-2xs text-text-faint">
                                    {line + 1}
                                  </span>
                                </button>
                                {sessionId && (
                                  <QuickFixMenu
                                    sessionId={sessionId}
                                    file={group.file}
                                    range={d.range}
                                    className="lx-hover-actions mt-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                                  />
                                )}
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              <MenuEntries
                                entries={problemMenu(group.file, d, () =>
                                  openFile(group.file, d.range),
                                )}
                                family="context"
                              />
                            </ContextMenuContent>
                          </ContextMenu>
                          {related.map((r, ri) => (
                            <button
                              key={`${group.file}:${line}:${i}:rel:${ri}`}
                              type="button"
                              onClick={() => openFile(r.location.file, r.location.range)}
                              title={`${r.message} — ${baseName(r.location.file)}:${r.location.range.start.line + 1}`}
                              className="flex w-full items-start gap-2 py-[0.15rem] pl-12 pr-3 text-left text-2xs text-text-faint outline-none transition-colors focus-ring hover:bg-surface-hover hover:text-text-soft"
                            >
                              <CornerDownRight className="mt-0.5 size-3 shrink-0 text-text-faint" />
                              <span className="min-w-0 flex-1 truncate">{r.message}</span>
                              <span className="shrink-0 truncate text-2xs text-text-faint">
                                {r.location.file === group.file
                                  ? ''
                                  : `${baseName(r.location.file)}:`}
                                {r.location.range.start.line + 1}
                              </span>
                            </button>
                          ))}
                        </div>
                      )
                    })}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

/** A severity toggle chip (Error/Warning/Info) with its live count; dims when off. */
function SeverityChip({
  bucket,
  count,
  hidden,
  onToggle,
}: {
  bucket: number
  count: number
  hidden: ReadonlySet<number>
  onToggle: (bucket: number) => void
}) {
  const sev = SEVERITY[bucket]
  const active = !hidden.has(bucket)
  return (
    <TogglePill
      active={active}
      onClick={() => onToggle(bucket)}
      title={`${active ? 'Hide' : 'Show'} ${sev.label.toLowerCase()}s`}
      // Selected = the 11% `surface-active` veil, not `bg-surface-raised` (a darker ground).
      activeClassName="border-control-border/55 bg-surface-active text-foreground"
      className={active ? '' : 'opacity-45'}
    >
      <sev.Icon className={`size-3 ${sev.color}`} />
      <span className="tabular-nums">{count}</span>
    </TogglePill>
  )
}
