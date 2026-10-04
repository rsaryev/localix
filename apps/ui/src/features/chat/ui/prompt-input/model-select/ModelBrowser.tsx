import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
  useDeferredValue,
  type ReactNode,
} from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { Command } from '@localixai/kit/command'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { PanelHeader } from '@localixai/kit/panel-header'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import {
  sortProvidersOAuthFirst,
  type CatalogModel,
  type ProviderEntry,
} from '@localixai/agent/catalog'
import { useModelsCatalog } from '@/shared/hooks/useModelsCatalog'
import { useInfiniteScroll } from '@localixai/plugin-sdk/ui/visibility'
import type { ReasoningEffort } from '../../../model/reasoning'
import type { useConnections } from '../useConnections'
import { useModelHoverDetails } from './useModelHoverDetails'
import { useModelSelectProviders } from './useModelSelectProviders'
import { filterModels, availableModelFilters, type ModelFilter } from './filterModels'
import { AddConnectionForm } from './AddConnectionForm'
import type { SelectedItem } from './ModelSelectSidebar'
import { ConnectionSettingsPanel } from './ConnectionSettingsPanel'
import { ModelDetailsSidePanel } from './ModelDetailsSidePanel'
import { CmdkHighlightWatcher } from './CmdkHighlightWatcher'
import { ConnectionModelList } from './ConnectionModelList'
import { CrossConnectionModelList } from './CrossConnectionModelList'
import { resolveModelEntries, searchModelEntries } from './resolvedModelEntries'
import {
  getFavoriteModels,
  toggleFavorite,
  isFavoriteModel,
  type FavoriteModel,
} from './favoriteModels'
import type { ParticipantRow } from './ModelTaskColumn'
import { agentTarget, targetAgentId, workloadKey, type PickerTarget } from './pickerTarget'
import { MODEL_ROUTING_TASKS } from '@localixai/api/client'
import { useModelTaskRouting } from './useModelTaskRouting'
import { participantSlot } from './participantSlot'
import { selectedTaskModelId } from './taskReasoning'
import { ModelBrowserSearchToolbar } from './ModelBrowserSearchToolbar'
import { ModelFilterMenu } from './ModelFilterMenu'
import { ModelDetailSettings } from './ModelDetailSettings'
import { PickerPanelTitle } from './PickerPanelTitle'
import { pickerColumns } from './pickerColumns'
import { PICKER_ROW_LEADING, pickerRow } from './pickerRow'

const PAGE_SIZE = 50

/** Stable identity: a fresh literal each render would defeat the memoized subtree. */
const NO_PARTICIPANTS: readonly ParticipantRow[] = []

interface ModelBrowserProps {
  /** Catalog models (+ any caller-supplied extras). Live per-connection models are discovered here. */
  models: CatalogModel[]
  connectionsState: ReturnType<typeof useConnections>
  /** Current session model + its connection — drives the checkmark and the task summary. */
  sessionModelId: string
  sessionConnectionId: string | null
  /**
   * Assign the model. Chat closes the drawer and re-routes the participant `agentId` names;
   * onboarding and the agent editor have no party, so they ignore it and remember the pair.
   */
  onPickSessionModel: (
    connectionId: string,
    modelId: string,
    reasoningEffort?: ReasoningEffort,
    agentId?: string,
  ) => void | Promise<void>
  /** Current session effort; before a session exists, the browser falls back to low. */
  reasoningEffort?: ReasoningEffort
  /**
   * `agentId` names WHOSE effort this is. It used to be absent, so the write always landed on
   * the conversation's first participant however many rows the column showed — in a room, on
   * somebody other than the one being configured.
   */
  onReasoningEffortChange?: (effort: ReasoningEffort, agentId?: string) => void
  /** Height utility classes for the Command container. */
  heightClassName?: string
  /** Optional activation-only seed supplied by a UI location. */
  initialQuery?: string
  /** Prefer a connected or connectable provider when the picker opens. */
  initialProviderId?: string
  /**
   * Show the "For which task" column. Off when the browser picks a model for something that
   * is NOT a workload route — an agent definition, say — where a click on another task row
   * would silently rewrite the user's live routing from inside an unrelated form.
   */
  taskColumn?: boolean
  /**
   * WHO the open conversation is with, in join order. Each becomes a row in the workload
   * column, and picking a model there routes that ONE participant.
   *
   * Empty where there is no conversation (onboarding, the agent editor). The column then shows
   * the workload catalog alone — no branch, because a party is a list and this one has nothing
   * in it.
   */
  participants?: readonly ParticipantRow[]
}

/**
 * Shared by chat and onboarding: target, provider, model list, and details.
 * Conversation picks call `onPickSessionModel`; workload picks update their settings route.
 */
export function ModelBrowser({
  models,
  connectionsState,
  sessionModelId,
  sessionConnectionId,
  onPickSessionModel,
  reasoningEffort,
  onReasoningEffortChange,
  heightClassName = 'h-[82dvh] sm:h-[min(680px,82dvh)]',
  initialQuery = '',
  initialProviderId,
  taskColumn = true,
  participants = NO_PARTICIPANTS,
}: ModelBrowserProps) {
  const {
    connections,
    activeId,
    addApiKeyConnection,
    addOAuthConnection,
    remove,
    updateLabel,
    addKey,
    removeKey,
    updateKey,
  } = connectionsState
  const [search, setSearch] = useState(initialQuery)
  const deferredSearch = useDeferredValue(search)
  // The provider rail filters on its own query. One shared query used to narrow both columns at
  // once, so looking for a model also emptied the add-provider list.
  const [providerSearch, setProviderSearch] = useState('')
  const deferredProviderSearch = useDeferredValue(providerSearch)
  const [filters, setFilters] = useState<ModelFilter[]>([])
  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null)
  const [editMode, setEditMode] = useState(false)
  // Below lg the details (and the model's settings) open in place of the list.
  const [detailsView, setDetailsView] = useState(false)
  const [renameLabel, setRenameLabel] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [taskKey, setTaskKey] = useState<PickerTarget>(
    participants.length > 0 ? agentTarget(participants[0]!.agentId) : 'session',
  )
  const participantRoute = useCallback(
    (agentId: string) => participantSlot(participants, agentId, sessionConnectionId),
    [participants, sessionConnectionId],
  )
  const [favorites, setFavorites] = useState<FavoriteModel[]>(() => getFavoriteModels())

  const { providers: allProviders, oauthProviderIds, oauthProviders } = useModelsCatalog()

  const { providerCounts, oauthIdSet, unconnectedProviders, filteredUnconnectedProviders } =
    useModelSelectProviders({
      models,
      allProviders,
      oauthProviderIds,
      connections,
      deferredSearch: deferredProviderSearch,
    })
  const orderedConnections = useMemo(
    () => sortProvidersOAuthFirst(connections, oauthIdSet, (connection) => connection.providerId),
    [connections, oauthIdSet],
  )

  const {
    recent,
    setRouteSlot,
    slotForTask,
    enabledForTask,
    liveSlotFor,
    setTaskEnabled,
    modelLabelFor,
    currentSlot,
    currentLiveSlot,
    resolveRowReasoning,
    inheritedRowReasoning,
    changeModelReasoning,
    pickModel,
  } = // Each participant answers for itself. The party arrives already resolved by the server
    // (conversation, then project, then the agent's card), so the column shows what each member
    // will actually run on rather than repeating whoever the picker has selected.
    useModelTaskRouting({
      models,
      connections,
      orderedConnections,
      taskKey,
      sessionModelId,
      sessionConnectionId,
      participantRoute: participants.length > 0 ? participantRoute : undefined,
      reasoningEffort,
      onReasoningEffortChange,
      onPickSessionModel,
    })

  // Initialize the sidebar selection ONCE per mount (render-time adjust — the
  // selection is derived from the first data that arrives). We must not re-sync
  // on every connections change — the OAuth device-code/local-server poll mutates
  // the connections array identity, and re-syncing would yank the user off the
  // provider add-form (losing the device code) back to the active connection.
  const [selectionInitialized, setSelectionInitialized] = useState(false)
  if (!selectionInitialized) {
    const preferredConnection = initialProviderId
      ? connections.find((connection) => connection.providerId === initialProviderId)
      : undefined
    const preferredProvider = initialProviderId
      ? unconnectedProviders.find((provider) => provider.id === initialProviderId)
      : undefined
    if (preferredConnection) {
      setSelectedItem({ type: 'connection', id: preferredConnection.id })
      setSelectionInitialized(true)
    } else if (preferredProvider) {
      setSelectedItem({ type: 'provider', id: preferredProvider.id })
      setSelectionInitialized(true)
    } else if (currentLiveSlot) {
      setSelectedItem({ type: 'connection', id: currentLiveSlot.connection.id })
      setSelectionInitialized(true)
    } else if (activeId && connections.some((c) => c.id === activeId)) {
      setSelectedItem({ type: 'connection', id: activeId })
      setSelectionInitialized(true)
    } else if (connections.length > 0) {
      setSelectedItem({ type: 'connection', id: connections[connections.length - 1].id })
      setSelectionInitialized(true)
    } else if (unconnectedProviders.length > 0) {
      setSelectedItem({ type: 'provider', id: unconnectedProviders[0].id })
      setSelectionInitialized(true)
    }
  }

  // When an OAuth flow finishes and a NEW connection for the provider we're adding
  // appears, jump from the add-form to it (shows its models instead of "waiting…").
  const addingRef = useRef<{ providerId: string; ids: Set<string> } | null>(null)
  useEffect(() => {
    if (selectedItem?.type !== 'provider') {
      addingRef.current = null
      return
    }
    const providerId = selectedItem.id
    const current = connections.filter((c) => c.providerId === providerId)
    if (!addingRef.current || addingRef.current.providerId !== providerId) {
      addingRef.current = { providerId, ids: new Set(current.map((c) => c.id)) }
      return
    }
    const fresh = current.find((c) => !addingRef.current!.ids.has(c.id))
    if (fresh) {
      addingRef.current = null
      setSelectedItem({ type: 'connection', id: fresh.id })
    }
  }, [connections, selectedItem])

  const {
    detailsPinned,
    setDetailsPinned,
    detailModel,
    detailConnectionId,
    detailProviderDoc,
    showDetails,
    scheduleHideHover,
    cancelHideHover,
    handleModelMouseEnter,
    armKeyboardNav,
    reportHighlight,
    clearFollow,
  } = useModelHoverDetails(
    currentSlot?.modelId ?? '',
    currentSlot?.providerConnectionId ?? null,
    selectedItem?.type === 'connection' ? selectedItem.id : null,
    models,
    connections,
    allProviders,
  )

  // Capability filters are scoped to the previewed connection — clear them when
  // the selection changes so a stale facet can't empty a different provider's list
  // (render-time adjust). The hover/keyboard detail-follow drop stays an effect:
  // it pokes external hover state, not derived render state.
  const [lastSelectedItem, setLastSelectedItem] = useState<SelectedItem>(selectedItem)
  if (lastSelectedItem !== selectedItem) {
    setLastSelectedItem(selectedItem)
    setVisibleCount(PAGE_SIZE)
    setFilters([])
    setEditMode(false)
    setDetailsView(false)
  }
  useEffect(() => {
    clearFollow()
  }, [selectedItem, clearFollow])

  const selectedConn = useMemo(() => {
    if (selectedItem?.type !== 'connection') return null
    return connections.find((c) => c.id === selectedItem.id) ?? null
  }, [selectedItem, connections])

  // Seed the rename field from the selected connection (render-time adjust).
  const [lastConn, setLastConn] = useState(selectedConn)
  if (lastConn !== selectedConn) {
    setLastConn(selectedConn)
    if (selectedConn) setRenameLabel(selectedConn.label)
  }

  const filteredModels = useMemo(
    () => filterModels(models, selectedConn?.providerId, deferredSearch, filters),
    [models, selectedConn, deferredSearch, filters],
  )

  // The connection's whole list, before search and filters: what the facets are offered from
  // and what the header's "4 of 12" counts against.
  const connectionModels = useMemo(
    () => filterModels(models, selectedConn?.providerId, ''),
    [models, selectedConn],
  )
  const availableFilters = useMemo(
    () => availableModelFilters(connectionModels),
    [connectionModels],
  )

  const toggleFilter = useCallback((f: ModelFilter) => {
    setFilters((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]))
    setVisibleCount(PAGE_SIZE)
  }, [])
  const clearFilters = useCallback(() => {
    setFilters([])
    setVisibleCount(PAGE_SIZE)
  }, [])

  const visibleModels = useMemo(
    () => filteredModels.slice(0, visibleCount),
    [filteredModels, visibleCount],
  )

  const loadMore = useCallback(() => {
    setVisibleCount((c) => Math.min(c + PAGE_SIZE, filteredModels.length))
  }, [filteredModels.length])

  const sentinelRef = useInfiniteScroll(loadMore, visibleCount < filteredModels.length)

  const handleAddApiKey = (
    provider: ProviderEntry,
    label: string,
    apiKey: string,
    opts?: { extraKeys?: string[] },
  ) => addApiKeyConnection(provider.id, provider.name, label, apiKey, opts)
  const handleAddOAuth = async (provider: ProviderEntry, label: string) =>
    addOAuthConnection(provider.id, provider.name, label)

  // Pick a task → preview the connection that already holds its model (if any).
  const selectTask = useCallback(
    (key: PickerTarget) => {
      setTaskKey(key)
      const slot = slotForTask(key)
      const live = liveSlotFor(slot)
      if (live) setSelectedItem({ type: 'connection', id: live.connection.id })
    },
    [liveSlotFor, slotForTask],
  )

  // The checkmark belongs to the ACTIVE target. In a room `sessionModelId` is the first
  // participant's model, so using it for every `agent:<id>` row painted that first model as
  // selected while configuring somebody else.
  const selectedValueForList = selectedTaskModelId(currentLiveSlot, selectedConn?.id)

  const onSelectModel = useCallback(
    (id: string) => {
      if (!selectedConn) return
      void pickModel(selectedConn.id, id)
    },
    [selectedConn, pickModel],
  )

  // Recent and Favorites, resolved against live connections + catalog (stale entries drop),
  // then narrowed by the model search.
  const validRecent = useMemo(
    () => resolveModelEntries(recent, models, connections),
    [connections, models, recent],
  )
  const resolvedRecent = useMemo(
    () => searchModelEntries(validRecent, deferredSearch),
    [validRecent, deferredSearch],
  )
  const validFavorites = useMemo(
    () => resolveModelEntries(favorites, models, connections),
    [connections, favorites, models],
  )
  const resolvedFavorites = useMemo(
    () => searchModelEntries(validFavorites, deferredSearch),
    [validFavorites, deferredSearch],
  )

  const isFavorite = useCallback(
    (connectionId: string, modelId: string) =>
      isFavoriteModel(favorites, { connectionId, modelId }),
    [favorites],
  )
  const toggleFav = useCallback((connectionId: string, modelId: string) => {
    setFavorites(toggleFavorite({ connectionId, modelId }))
  }, [])

  const activeTaskMeta = MODEL_ROUTING_TASKS.find((task) => task.key === taskKey)
  const activeTaskEnabled = enabledForTask(taskKey)
  // A participant has nothing to reset TO: its fallback is the agent's own model, and clearing
  // the conversation's choice is what the row's fallback label already offers.
  const resettableWorkload = workloadKey(taskKey)
  const resetRow = resettableWorkload ? (
    <button
      type="button"
      onClick={() => {
        setRouteSlot(resettableWorkload, null)
      }}
      // A model row's measure, so the reset reads as the list's first entry, not a loose button.
      className={pickerRow(!currentSlot, 'mb-1')}
    >
      <span className={cn(PICKER_ROW_LEADING, 'text-text-faint')}>
        <RotateCcw className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate">
        {activeTaskMeta?.fallbackLabel ?? 'Use session model'}
      </span>
    </button>
  ) : null
  const handleSearchChange = (value: string) => {
    setSearch(value)
    setVisibleCount(PAGE_SIZE)
  }
  // Whether the model the details panel shows is the one this target runs on: its settings
  // then edit the live route rather than the remembered per-model preference.
  const detailIsCurrent =
    detailModel !== null &&
    currentSlot?.providerConnectionId === detailConnectionId &&
    currentSlot?.modelId === detailModel.id
  const modelSettings = detailModel?.supportsReasoning ? (
    <ModelDetailSettings
      model={detailModel}
      current={detailIsCurrent}
      minimumReasoning={taskKey === 'inlineCompletion'}
      resolveRowReasoning={resolveRowReasoning}
      inheritedRowReasoning={inheritedRowReasoning}
      changeModelReasoning={changeModelReasoning}
    />
  ) : undefined

  const activeParticipant = participants.find((member) => member.agentId === targetAgentId(taskKey))
  const { taskColumnFor, providerColumnFor, nav } = pickerColumns({
    taskColumn,
    allProviders,
    workloadLabel:
      activeParticipant?.label ??
      activeParticipant?.handle ??
      activeTaskMeta?.label ??
      'Chat sessions',
    task: {
      activeTask: taskKey,
      onSelectTask: selectTask,
      modelLabelFor,
      enabledFor: enabledForTask,
      onEnabledChange: setTaskEnabled,
      participants,
    },
    provider: {
      connections: orderedConnections,
      selectedItem,
      setSelectedItem,
      selectedConn,
      activeId,
      providerCounts,
      filteredUnconnectedProviders,
      oauthIdSet,
      recentCount: validRecent.length,
      favoriteCount: validFavorites.length,
      providerSearch,
      onProviderSearchChange: setProviderSearch,
    },
  })

  // The model column's second band. Exactly one model list mounts it, under its header; the
  // filter menu rides along only where facets exist (a single connection's list).
  const searchToolbar = (filterMenu?: ReactNode) => (
    <ModelBrowserSearchToolbar
      search={search}
      onSearchChange={handleSearchChange}
      armKeyboardNav={armKeyboardNav}
      disabled={!activeTaskEnabled}
      trailing={filterMenu}
    />
  )

  return (
    <Command
      shouldFilter={false}
      label="Search models and providers"
      className={cn('flex flex-col overflow-hidden rounded-t-2xl p-0!', heightClassName)}
      data-vaul-no-drag
    >
      {/* Lifts cmdk's live highlight up so the detail panel can follow keyboard nav. */}
      <CmdkHighlightWatcher onHighlight={reportHighlight} />

      {/* Columns by width — see `pickerColumnFrame`: below md only the main panel shows, and
          its header switchers open the workload and provider columns as sheets. */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {taskColumn && taskColumnFor('column')}

        <div className="relative flex min-w-0 flex-1 overflow-hidden">
          <div
            className={cn(
              'flex min-w-0 flex-1 overflow-hidden transition-[opacity,filter] duration-(--dur-base)',
              !activeTaskEnabled && 'pointer-events-none select-none opacity-30 saturate-0',
            )}
            aria-disabled={!activeTaskEnabled}
            inert={!activeTaskEnabled}
          >
            {providerColumnFor('column')}

            {/* ── Right area ── */}
            <div className="flex min-w-0 flex-1 overflow-hidden">
              {/* Below lg the details open in place of the list (`detailsView`). */}
              {detailsView && (
                <ModelDetailsSidePanel
                  variant="view"
                  showDetails
                  detailModel={detailModel}
                  detailProviderDoc={detailProviderDoc}
                  settings={modelSettings}
                  onClose={() => setDetailsView(false)}
                />
              )}
              {/* Main panel (model list / connection settings / add provider / empty) */}
              <div
                data-slot="model-browser-main-panel"
                className={cn(
                  'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
                  detailsView && 'max-lg:hidden',
                )}
              >
                {/* ── Favorite models (cross-connection) ── */}
                {selectedItem?.type === 'favorite' && (
                  <CrossConnectionModelList
                    searchToolbar={searchToolbar()}
                    nav={nav}
                    totalCount={validFavorites.length}
                    title="Favorites"
                    emptyLabel="No favorite models yet"
                    items={resolvedFavorites}
                    selectedConnectionId={currentSlot?.providerConnectionId ?? null}
                    selectedModelId={currentSlot?.modelId ?? ''}
                    onSelect={(connectionId, id) => void pickModel(connectionId, id)}
                    onModelMouseEnter={handleModelMouseEnter}
                    onModelMouseLeave={scheduleHideHover}
                    isFavorite={isFavorite}
                    onToggleFavorite={toggleFav}
                  />
                )}

                {/* ── Recent models (cross-connection) ── */}
                {selectedItem?.type === 'recent' && (
                  <CrossConnectionModelList
                    searchToolbar={searchToolbar()}
                    nav={nav}
                    totalCount={validRecent.length}
                    title="Recent"
                    emptyLabel="No recent models yet"
                    items={resolvedRecent}
                    selectedConnectionId={currentSlot?.providerConnectionId ?? null}
                    selectedModelId={currentSlot?.modelId ?? ''}
                    onSelect={(connectionId, id) => void pickModel(connectionId, id)}
                    onModelMouseEnter={handleModelMouseEnter}
                    onModelMouseLeave={scheduleHideHover}
                    isFavorite={isFavorite}
                    onToggleFavorite={toggleFav}
                  />
                )}

                {/* ── Model list ── */}
                {selectedItem?.type === 'connection' && selectedConn?.hasApiKey && !editMode && (
                  <ConnectionModelList
                    searchToolbar={searchToolbar(
                      <ModelFilterMenu
                        available={availableFilters}
                        active={filters}
                        onToggle={toggleFilter}
                        onClear={clearFilters}
                      />,
                    )}
                    nav={nav}
                    totalCount={connectionModels.length}
                    selectedConn={selectedConn}
                    detailsPinned={detailsPinned}
                    onToggleDetails={() => setDetailsPinned((v) => !v)}
                    onOpenDetailsView={() => setDetailsView(true)}
                    onOpenSettings={() => setEditMode(true)}
                    filteredModels={filteredModels}
                    visibleModels={visibleModels}
                    visibleCount={visibleCount}
                    sentinelRef={sentinelRef}
                    selectedValue={selectedValueForList}
                    prepend={resetRow}
                    onSelectModel={onSelectModel}
                    onModelMouseEnter={(id) => handleModelMouseEnter(selectedConn.id, id)}
                    onModelMouseLeave={scheduleHideHover}
                    isFavorite={(id) => isFavorite(selectedConn.id, id)}
                    onToggleFavorite={(id) => toggleFav(selectedConn.id, id)}
                  />
                )}

                {/* ── Connection settings ── */}
                {selectedItem?.type === 'connection' &&
                  selectedConn &&
                  (editMode || !selectedConn.hasApiKey) && (
                    <ConnectionSettingsPanel
                      nav={nav}
                      connection={selectedConn}
                      connections={connections}
                      allProviders={allProviders}
                      renameLabel={renameLabel}
                      setRenameLabel={setRenameLabel}
                      updateLabel={updateLabel}
                      addKey={addKey}
                      removeKey={removeKey}
                      updateKey={updateKey}
                      remove={remove}
                      onExitEdit={() => setEditMode(false)}
                      setSelectedItem={setSelectedItem}
                    />
                  )}

                {/* ── Add provider form ── */}
                {selectedItem?.type === 'provider' &&
                  (() => {
                    const p = allProviders.find((prov) => prov.id === selectedItem.id)
                    if (!p) return null
                    return (
                      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                        <AddConnectionForm
                          nav={nav}
                          provider={p}
                          isOAuth={oauthProviderIds.includes(p.id)}
                          oauthLabel={oauthProviders.find((o) => o.providerId === p.id)?.loginLabel}
                          oauthDescription={
                            oauthProviders.find((o) => o.providerId === p.id)?.loginDescription
                          }
                          onAdded={() => setEditMode(false)}
                          onAddApiKey={(label, apiKey, opts) => {
                            void handleAddApiKey(p, label, apiKey, opts)
                          }}
                          onAddOAuth={(label) => handleAddOAuth(p, label)}
                        />
                      </div>
                    )
                  })()}

                {/* ── Empty state ── */}
                {!selectedItem && (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <PanelHeader
                      tone="content"
                      title={<PickerPanelTitle title="Models" nav={nav} />}
                    />
                    <EmptyHint className="flex-1 px-6 text-2xs">
                      Pick a connection, or add a provider.
                    </EmptyHint>
                  </div>
                )}
              </div>

              {/* ── Model details side panel (collapsible) ── */}
              <ModelDetailsSidePanel
                showDetails={showDetails}
                detailModel={detailModel}
                detailProviderDoc={detailProviderDoc}
                settings={modelSettings}
                onClose={() => {
                  setDetailsPinned(false)
                  clearFollow()
                }}
                onMouseEnter={cancelHideHover}
                onMouseLeave={scheduleHideHover}
              />
            </div>
          </div>
          {!activeTaskEnabled && (
            // The way back on, right where it is needed. Below md the workload switch lives in a
            // sheet behind this inert area, so a hint pointing at it alone was a dead end.
            <div className="absolute inset-0 z-(--z-controls) flex flex-col items-center justify-center gap-3 px-8 text-center">
              <p className="text-xs text-text-faint">{activeTaskMeta?.label} is off</p>
              {resettableWorkload && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTaskEnabled(resettableWorkload, true)}
                >
                  Turn on
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </Command>
  )
}
