import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'
import { useVisiblePolling } from '@localixai/plugin-sdk/ui/visibility'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { RefreshAction } from '@localixai/kit/refresh-action'
import { useExternalAgentsProblem } from './problems'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import { SegmentedControl, SegmentedControlItem } from '@localixai/plugin-sdk/ui/segmented-control'
import { useProviders } from './model/useProviders'
import { isLive } from './model/stateTone'
import { middleEllipsis } from './model/pathLabel'
import { nextRefreshDelay, REFRESH_COLD_MS } from './model/refreshPolicy'
import { useStats } from './model/useStats'
import { useHistoryStream } from './model/useHistoryStream'
import { StatsView, type StatsDays } from './ui/StatsView'
import { useRoster } from './model/useRoster'
import type { RosterRow } from './model/types'
import { RosterFilters } from './ui/RosterFilters'
import { RosterFooter } from './ui/RosterFooter'
import { RosterList } from './ui/RosterList'

/**
 * External Agents — one roster of coding-agent sessions from OTHER agents.
 *
 * Live delegations and sessions discovered on disk share a single list and are told apart by their
 * STATE and provenance labels, not by separate screens: a session that finished five minutes ago
 * and one found in last month's history are the same kind of object, and splitting them would make
 * the boundary between them a UI concept rather than a real one.
 *
 * A master list and nothing else. The detail pane is gone because a session is a TAB now
 * (`openExternalAgentSession`) — one place where a transcript is read, whether it was reached from
 * this list, from a `@resource` chip, from `/open` or from search.
 */
export function ExternalAgentsPanel({
  requestedProviders,
}: {
  /** Provider filter carried by the opening payload — e.g. a `…/external-agent/codex` anchor. */
  requestedProviders?: readonly string[]
}) {
  // Warm work items stay mounted under `display: none` after a tab switch. Every read below scans
  // agent history roots on disk, so a hidden roster must buy none of them.
  const visible = useWorkItemVisible()

  const [text, setText] = useState('')
  const [providers, setProviders] = useState<string[]>([])
  /** The project drill, from the statistics' project axis — one filter, obeyed by both views. */
  const [cwdPrefix, setCwdPrefix] = useState<string | undefined>(undefined)
  /** Sub-agent transcripts, hidden by default — 1,540 of a real history's 1,822 rows. */
  const [includeChildren, setIncludeChildren] = useState(false)
  /** Chosen on the statistics screen, obeyed by both views, and shown as a chip in the filter row. */
  const [model, setModel] = useState<string | undefined>(undefined)
  /** A parent chosen on the fan-out axis: the list then shows the sub-agents it spawned. */
  const [parentKey, setParentKey] = useState<string | undefined>(undefined)
  const [reloadToken, setReloadToken] = useState(0)
  const [view, setView] = useState<'sessions' | 'stats'>('sessions')
  const [days, setDays] = useState<StatsDays>('30')

  const providerState = useProviders(reloadToken, visible)
  const roster = useRoster(
    {
      text,
      providers,
      states: [],
      ...(cwdPrefix ? { cwdPrefix } : {}),
      ...(includeChildren ? { includeChildren: true } : {}),
      ...(model ? { model } : {}),
      ...(parentKey ? { parentKey } : {}),
    },
    reloadToken,
    visible,
  )
  // Only the visible half pays: statistics fold the same index the roster reads, but there is no
  // reason to fold it while nobody is looking at the result.
  const stats = useStats(
    providers,
    Number(days),
    reloadToken,
    visible && view === 'stats',
    cwdPrefix,
    model,
    // The same toggle the list obeys: with it on the roster showed 1,535 sessions while every figure
    // beside it still answered for 252 — 55% of the tokens measured here sit in sub-agent transcripts.
    includeChildren,
  )
  // Follow a running delegation without polling four history roots on a fixed tick — the cadence
  // is decided by a pure policy (model/refreshPolicy.ts) from what is actually happening.
  const live = useMemo(() => roster.rows.filter(isLive).length, [roster.rows])
  const lastActivityAt = useMemo(
    () => roster.rows.reduce((latest, row) => Math.max(latest, row.updatedAt), 0) || undefined,
    [roster.rows],
  )
  // History writes are pushed by the backend's watch; the cadence below is then only a backstop.
  const historyPushed = useHistoryStream(visible, () => setReloadToken((n) => n + 1))
  const refresh = nextRefreshDelay({
    now: Date.now(),
    visible,
    liveDelegations: live,
    lastActivityAt,
    historyPushed,
  })
  // The CADENCE is ours; the GATING is the shared poller's.
  //
  // This used to be a hand-rolled `setTimeout`, and rolling it cost us document visibility:
  // `useWorkItemVisible` only knows about our own tab strip, so a window sitting behind another
  // application kept scanning four history roots on every tick — and a tick is TWO requests, since
  // the providers list and the roster both re-read. While a delegation ran that was 24 req/min
  // against a 4.3 req/min idle baseline, for a screen nobody was looking at. Watching a
  // long-running delegation from another app is this plugin's normal case, not its edge case.
  //
  // The reason string can now describe a cadence that is paused (the window is hidden while a
  // delegation runs). That is unobservable by construction — the footer holding it is hidden too —
  // and the focus refresh below makes it true again before it can be read.
  useVisiblePolling({
    enabled: refresh.delayMs !== null,
    intervalMs: refresh.delayMs ?? REFRESH_COLD_MS,
    onTick: () => setReloadToken((n) => n + 1),
    // Returning to the window should not mean waiting out a five-minute cold tick to see what
    // happened while you were away.
    refreshOnFocus: true,
  })

  const providerNames = useMemo(
    () => new Map(providerState.providers.map((p) => [p.provider, p.displayName])),
    [providerState.providers],
  )

  // Re-opening the singleton roster from another provider's anchor must RE-AIM the open tab, not
  // silently focus the filter it had. Keyed on the contents so a fresh array literal is inert.
  const requestedKey = requestedProviders?.join(',')
  useEffect(() => {
    if (requestedKey === undefined) return
    setProviders(requestedKey ? requestedKey.split(',') : [])
  }, [requestedKey])

  const toggleProvider = useCallback((provider: string) => {
    setProviders((prev) =>
      prev.includes(provider) ? prev.filter((p) => p !== provider) : [...prev, provider],
    )
  }, [])

  return (
    // `@container`: the statistics grids below reflow to the PANEL's own width, not the viewport —
    // the same containment context every other stat dashboard in the repo establishes.
    <div className="@container flex h-full min-h-0 w-full flex-col">
      {/* No PanelHeader: the work-item tab strip already carries the title and icon, so a header row
          would repeat the tab name and spend a second 36px seam saying it. The view switcher and the
          rescan action share ONE action row, as the Vault workspace does. */}
      <WorkbenchToolbar as="header" wrap aria-label="External Agents view">
        <SegmentedControl variant="muted" aria-label="External Agents view">
          <SegmentedControlItem active={view === 'sessions'} onClick={() => setView('sessions')}>
            Sessions
          </SegmentedControlItem>
          <SegmentedControlItem active={view === 'stats'} onClick={() => setView('stats')}>
            Stats
          </SegmentedControlItem>
        </SegmentedControl>
        <WorkbenchToolbarSection align="end" aria-label="External Agents actions">
          <RefreshAction
            size="sm"
            aria-label="Rescan providers"
            tooltip="Rescan providers"
            onClick={() => setReloadToken((n) => n + 1)}
          />
        </WorkbenchToolbarSection>
      </WorkbenchToolbar>
      <RosterFilters
        text={text}
        onTextChange={setText}
        providers={providerState.providers}
        providersError={providerState.error}
        providersErrorDetail={providerState.errorDetail}
        activeProviders={providers}
        onToggleProvider={toggleProvider}
        includeChildren={includeChildren}
        onToggleChildren={() => setIncludeChildren((on) => !on)}
        drills={[
          ...(cwdPrefix
            ? [
                {
                  key: 'project',
                  label: 'project',
                  value: middleEllipsis(cwdPrefix),
                  onClear: () => setCwdPrefix(undefined),
                },
              ]
            : []),
          ...(model
            ? [{ key: 'model', label: 'model', value: model, onClear: () => setModel(undefined) }]
            : []),
          ...(parentKey
            ? [
                {
                  key: 'parent',
                  label: 'sub-agents of',
                  value: parentKey,
                  onClear: () => setParentKey(undefined),
                },
              ]
            : []),
        ]}
      />
      {view === 'stats' ? (
        <StatsView
          stats={stats.stats}
          loading={stats.loading}
          error={stats.error}
          errorDetail={stats.errorDetail}
          onRetry={() => setReloadToken((n) => n + 1)}
          providerNames={providerNames}
          providers={providerState.providers}
          // Clicking an agent in the chart narrows the whole workspace, list included — one filter,
          // not a second one that only the chart obeys.
          onSelectProvider={toggleProvider}
          onSelectProject={(key) => setCwdPrefix((current) => (current === key ? undefined : key))}
          onSelectParent={(key) => {
            // The list is where 208 sub-agents can actually be read, so the drill goes there — the
            // same move the heaviest axis makes, with a filter that returns children rather than
            // the parent whose key was clicked.
            setParentKey((current) => (current === key ? undefined : key))
            setView('sessions')
          }}
          onSelectModel={(next) => setModel((current) => (current === next ? undefined : next))}
          {...(model ? { selectedModel: model } : {})}
          onSelectSession={(key) => {
            // Filter the roster to that one session and show it, rather than opening from a bucket
            // that carries no cwd. The reader opens the complete row.
            setText(key)
            setView('sessions')
          }}
          {...(cwdPrefix ? { selectedProject: cwdPrefix } : {})}
          selectedProvider={providers.length === 1 ? providers[0] : undefined}
          days={days}
          onChangeDays={setDays}
        />
      ) : (
        <>
          <RosterBody
            rows={roster.rows}
            roster={roster}
            providers={providerState.providers}
            onRetry={() => setReloadToken((n) => n + 1)}
          />
          <RosterFooter
            live={live}
            refreshReason={refresh.reason}
            shown={roster.rows.length}
            total={roster.total}
            withheld={roster.withheld}
            loadingMore={roster.loadingMore}
          />
        </>
      )}
    </div>
  )
}

/** Loading / error / empty / list — kept out of the panel body so the layout above stays readable. */
function RosterBody({
  rows,
  roster,
  providers,
  onRetry,
}: {
  rows: readonly RosterRow[]
  roster: ReturnType<typeof useRoster>
  providers: ReturnType<typeof useProviders>['providers']
  onRetry: () => void
}) {
  // No wrapper: the centred report already self-centers on `min-h-0 flex-1` in the panel column.
  const problem = useExternalAgentsProblem({
    subject: 'Roster',
    message: roster.error,
    detail: roster.errorDetail,
    onRetry,
    centered: true,
  })
  if (problem) return problem
  // A pane-level hint fills the space the list would have had, so it centers there instead of
  // sitting under the filters with the footer pulled up against it.
  if (roster.loading && rows.length === 0) {
    return <LoadingHint className="h-auto min-h-0 flex-1">Scanning agent history…</LoadingHint>
  }
  if (rows.length === 0) {
    return (
      <EmptyHint className="h-auto min-h-0 flex-1">No agent sessions match the filter.</EmptyHint>
    )
  }
  return <RosterList rows={rows} providers={providers} onReachEnd={roster.loadMore} />
}
