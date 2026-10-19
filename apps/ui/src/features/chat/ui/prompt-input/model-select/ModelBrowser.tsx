import { useState, useMemo, useEffect, useCallback, useDeferredValue, type ReactNode } from 'react'
import { Command } from '@localixai/kit/command'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { sortProvidersOAuthFirst, type ProviderEntry } from '@localixai/agent/catalog'
import { useModelsCatalog } from '@/shared/hooks/useModelsCatalog'
import type { ModelBrowserProps } from './modelBrowserProps'
import { useModelHoverDetails } from './useModelHoverDetails'
import { useModelSelectProviders } from './useModelSelectProviders'
import type { SelectedItem } from './ModelSelectSidebar'
import { ModelDetailsSidePanel } from './ModelDetailsSidePanel'
import { CmdkHighlightWatcher } from './CmdkHighlightWatcher'
import { useModelShortlists } from './useModelShortlists'
import { useModelListPaging } from './useModelListPaging'
import { initialModelSelection } from './initialModelSelection'
import type { ParticipantRow } from './ModelTaskColumn'
import { initialPickerTarget, targetAgentId, workloadKey, type PickerTarget } from './pickerTarget'
import { MODEL_ROUTING_TASKS } from '@localixai/api/model-task-catalog'
import { useModelTaskRouting } from './useModelTaskRouting'
import { useEmbeddingWorkload, useWorkloadModels } from './useEmbeddingWorkload'
import { participantSlot } from './participantSlot'
import { selectedTaskModelId } from './taskReasoning'
import { ResetRouteRow, WorkloadOffOverlay } from './ModelBrowserParts'
import { workloadLabelFor } from './modelBrowserLabels'
import { ModelBrowserMainPanel } from './ModelBrowserMainPanel'
import { ModelBrowserSearchToolbar } from './ModelBrowserSearchToolbar'
import { useAgentModelTurns } from './useAgentModelTurns'
import { ModelDetailSettings } from './ModelDetailSettings'
import { pickerColumns } from './pickerColumns'
import { usePartyRoute } from './usePartyRoute'
import { PARTY_TARGET } from './partyRoute'

/** Stable identity: a fresh literal each render would defeat the memoized subtree. */
const NO_PARTICIPANTS: readonly ParticipantRow[] = []

/**
 * Shared by chat and onboarding: target, provider, model list, and details.
 * Conversation picks call `onPickSessionModel`; workload picks update their settings route.
 */
export function ModelBrowser({
  models: chatModels,
  connectionsState,
  sessionModelId,
  sessionConnectionId,
  onPickSessionModel,
  reasoningEffort,
  onReasoningEffortChange,
  heightClassName = 'h-[82dvh] sm:h-[min(680px,82dvh)]',
  initialQuery = '',
  initialProviderId,
  initialConnectionId,
  initialWorkload,
  taskColumn = true,
  participants = NO_PARTICIPANTS,
  initialAgentId,
  onAgentTargetChange,
  onApplyPartyRoute,
  onDismiss,
}: ModelBrowserProps) {
  const { connections, activeId, addApiKeyConnection, addOAuthConnection } = connectionsState
  const [search, setSearch] = useState(initialQuery)
  const deferredSearch = useDeferredValue(search)
  // The provider rail filters on its own query. One shared query used to narrow both columns at
  // once, so looking for a model also emptied the add-provider list.
  const [providerSearch, setProviderSearch] = useState('')
  const deferredProviderSearch = useDeferredValue(providerSearch)
  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null)
  const [editMode, setEditMode] = useState(false)
  // Below lg the details (and the model's settings) open in place of the list.
  const [detailsView, setDetailsView] = useState(false)
  const [renameLabel, setRenameLabel] = useState('')
  const [taskKey, setTaskKey] = useState<PickerTarget>(
    () =>
      MODEL_ROUTING_TASKS.find((task) => task.key === initialWorkload)?.key ??
      initialPickerTarget(participants, initialAgentId),
  )
  const participantRoute = useCallback(
    (agentId: string) => participantSlot(participants, agentId, sessionConnectionId),
    [participants, sessionConnectionId],
  )

  const { providers: allProviders, oauthProviderIds, oauthProviders } = useModelsCatalog()
  const { taskKind, models, modelsFor } = useWorkloadModels(chatModels, taskKey)

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
  // "All agents": one model and level for every listed agent and for agents invited later.
  const party = usePartyRoute({
    participants,
    sessionConnectionId,
    models,
    connections: orderedConnections,
    onApplyPartyRoute,
  })

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
    isCurrentModel,
    reasoningFor,
    changeModelReasoning,
    pickModel,
  } = // Each participant answers for itself. The party arrives already resolved by the server
    // (conversation, then project, then the agent's card), so the column shows what each member
    // will actually run on rather than repeating whoever the picker has selected.
    useEmbeddingWorkload(
      useModelTaskRouting({
        modelsFor,
        connections,
        orderedConnections,
        taskKey,
        sessionModelId,
        sessionConnectionId,
        participantRoute: participants.length > 0 ? participantRoute : undefined,
        reasoningEffort,
        onReasoningEffortChange,
        onPickSessionModel,
        partyRoute: party.partyRoute,
        onPickPartyModel: party.onPickPartyModel,
        onPartyReasoningChange: party.onPartyReasoningChange,
      }),
      taskKey,
      orderedConnections,
    )

  // Initialize the sidebar selection ONCE per mount (render-time adjust — the
  // selection is derived from the first data that arrives). We must not re-sync
  // on every connections change — the OAuth device-code/local-server poll mutates
  // the connections array identity, and re-syncing would yank the user off the
  // provider add-form (losing the device code) back to the active connection.
  const [selectionInitialized, setSelectionInitialized] = useState(false)
  if (!selectionInitialized) {
    const initial = initialModelSelection({
      connections,
      unconnectedProviders,
      initialConnectionId,
      initialProviderId,
      currentLiveConnectionId: currentLiveSlot?.connection.id,
      activeId,
    })
    if (initial) {
      setSelectedItem(initial)
      setSelectionInitialized(true)
    }
  }

  const {
    detailsPinned,
    setDetailsPinned,
    detailModel,
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

  const selectedConn = useMemo(() => {
    if (selectedItem?.type !== 'connection') return null
    return connections.find((c) => c.id === selectedItem.id) ?? null
  }, [selectedItem, connections])

  const paging = useModelListPaging(models, selectedConn?.providerId, deferredSearch)
  const { setFilters, resetPaging } = paging

  // Capability filters are scoped to the previewed connection — clear them when
  // the selection changes so a stale facet can't empty a different provider's list
  // (render-time adjust). The hover/keyboard detail-follow drop stays an effect:
  // it pokes external hover state, not derived render state.
  const [lastSelectedItem, setLastSelectedItem] = useState<SelectedItem>(selectedItem)
  if (lastSelectedItem !== selectedItem) {
    setLastSelectedItem(selectedItem)
    resetPaging()
    setFilters([])
    setEditMode(false)
    setDetailsView(false)
  }
  useEffect(() => {
    clearFollow()
  }, [selectedItem, clearFollow])

  // Seed the rename field from the selected connection (render-time adjust).
  const [lastConn, setLastConn] = useState(selectedConn)
  if (lastConn !== selectedConn) {
    setLastConn(selectedConn)
    if (selectedConn) setRenameLabel(selectedConn.label)
  }

  const showConnectionModels = (connectionId: string) => {
    setSelectedItem({ type: 'connection', id: connectionId })
    setEditMode(false)
    setSearch('')
    setFilters([])
    setDetailsView(false)
  }
  const handleAddApiKey = async (
    provider: ProviderEntry,
    label: string,
    apiKey: string,
    opts?: { extraKeys?: string[] },
  ) => {
    const connection = await addApiKeyConnection(provider.id, provider.name, label, apiKey, opts)
    showConnectionModels(connection.id)
  }
  const handleAddOAuth = async (provider: ProviderEntry, label: string) =>
    addOAuthConnection(provider.id, provider.name, label, showConnectionModels)

  // Pick a task → preview the connection that already holds its model (if any).
  const selectTask = useCallback(
    (key: PickerTarget) => {
      setTaskKey(key)
      const agentId = targetAgentId(key)
      if (agentId !== null) onAgentTargetChange?.(agentId)
      const slot = slotForTask(key)
      const live = liveSlotFor(slot)
      if (live) setSelectedItem({ type: 'connection', id: live.connection.id })
    },
    [liveSlotFor, onAgentTargetChange, slotForTask],
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

  const shortlists = useModelShortlists(recent, models, connections, deferredSearch)
  const { recentCount, favoriteCount } = shortlists

  const activeTaskMeta = MODEL_ROUTING_TASKS.find((task) => task.key === taskKey)
  const activeTaskEnabled = enabledForTask(taskKey)
  // A participant has nothing to reset TO: its fallback is the agent's own model, and clearing
  // the conversation's choice is what the row's fallback label already offers. Semantic search
  // owns its model in its own service, so it has no route to clear.
  const resettableWorkload = workloadKey(taskKey)
  const resetRow =
    resettableWorkload && taskKind !== 'embedding' ? (
      <ResetRouteRow
        selected={!currentSlot}
        label={activeTaskMeta?.fallbackLabel ?? 'Use session model'}
        onReset={() => setRouteSlot(resettableWorkload, null)}
      />
    ) : null
  const handleSearchChange = (value: string) => {
    setSearch(value)
    resetPaging()
  }
  const activeParticipant = participants.find((member) => member.agentId === targetAgentId(taskKey))
  const modelTurns = useAgentModelTurns(
    targetAgentId(taskKey),
    detailModel?.providerId,
    detailModel?.id,
    activeParticipant?.maxTurnsLimit,
  )
  const modelSettings =
    detailModel && (detailModel.supportsReasoning || activeParticipant) ? (
      <ModelDetailSettings
        model={detailModel}
        current={isCurrentModel(detailModel)}
        minimumReasoning={taskKey === 'inlineCompletion'}
        reasoningFor={reasoningFor}
        changeModelReasoning={changeModelReasoning}
        turns={activeParticipant ? modelTurns : undefined}
      />
    ) : undefined

  const { taskColumnFor, providerColumnFor, nav } = pickerColumns({
    taskColumn,
    allProviders,
    workloadLabel:
      taskKey === PARTY_TARGET
        ? 'All agents'
        : workloadLabelFor(activeParticipant, activeTaskMeta?.label),
    task: {
      activeTask: taskKey,
      onSelectTask: selectTask,
      modelLabelFor,
      enabledFor: enabledForTask,
      onEnabledChange: setTaskEnabled,
      participants,
      party: party.column,
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
      recentCount,
      favoriteCount,
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
              <ModelBrowserMainPanel
                detailsView={detailsView}
                setDetailsView={setDetailsView}
                selectedItem={selectedItem}
                setSelectedItem={setSelectedItem}
                selectedConn={selectedConn}
                editMode={editMode}
                setEditMode={setEditMode}
                searchToolbar={searchToolbar}
                nav={nav}
                paging={paging}
                shortlists={shortlists}
                connectionsState={connectionsState}
                allProviders={allProviders}
                oauthProviderIds={oauthProviderIds}
                oauthProviders={oauthProviders}
                currentConnectionId={currentSlot?.providerConnectionId ?? null}
                currentModelId={currentSlot?.modelId ?? ''}
                selectedValue={selectedValueForList}
                resetRow={resetRow}
                detailsPinned={detailsPinned}
                setDetailsPinned={setDetailsPinned}
                pickModel={pickModel}
                onSelectModel={onSelectModel}
                onModelMouseEnter={handleModelMouseEnter}
                onModelMouseLeave={scheduleHideHover}
                renameLabel={renameLabel}
                setRenameLabel={setRenameLabel}
                onAddApiKey={handleAddApiKey}
                onAddOAuth={handleAddOAuth}
                modelKind={taskKind}
                onDismiss={onDismiss}
              />

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
            <WorkloadOffOverlay
              label={activeTaskMeta?.label}
              onTurnOn={
                resettableWorkload ? () => setTaskEnabled(resettableWorkload, true) : undefined
              }
            />
          )}
        </div>
      </div>
    </Command>
  )
}
