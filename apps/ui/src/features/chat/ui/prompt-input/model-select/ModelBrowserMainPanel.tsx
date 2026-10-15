import type { ReactNode } from 'react'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { PanelHeader } from '@localixai/kit/panel-header'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import type { ProviderEntry } from '@localixai/agent/catalog'
import type { ProviderConnection } from '@/shared/api/contracts'
import type { useModelsCatalog } from '@/shared/hooks/useModelsCatalog'
import type { useConnections } from '../useConnections'
import { AddConnectionForm } from './AddConnectionForm'
import { ConnectionModelList } from './ConnectionModelList'
import { ConnectionSettingsPanel } from './ConnectionSettingsPanel'
import { CrossConnectionModelList } from './CrossConnectionModelList'
import { ModelFilterMenu } from './ModelFilterMenu'
import type { SelectedItem } from './ModelSelectSidebar'
import { PickerPanelTitle } from './PickerPanelTitle'
import type { useModelListPaging } from './useModelListPaging'
import type { useModelShortlists } from './useModelShortlists'

type Catalog = ReturnType<typeof useModelsCatalog>

export interface ModelBrowserMainPanelProps {
  detailsView: boolean
  setDetailsView: (open: boolean) => void
  selectedItem: SelectedItem
  setSelectedItem: (item: SelectedItem) => void
  selectedConn: ProviderConnection | null
  editMode: boolean
  setEditMode: (edit: boolean) => void
  searchToolbar: (filterMenu?: ReactNode) => ReactNode
  nav: ReactNode
  paging: ReturnType<typeof useModelListPaging>
  shortlists: ReturnType<typeof useModelShortlists>
  connectionsState: ReturnType<typeof useConnections>
  allProviders: ProviderEntry[]
  oauthProviderIds: Catalog['oauthProviderIds']
  oauthProviders: Catalog['oauthProviders']
  currentConnectionId: string | null
  currentModelId: string
  selectedValue: string
  resetRow: ReactNode
  detailsPinned: boolean
  setDetailsPinned: (update: (pinned: boolean) => boolean) => void
  pickModel: (connectionId: string, modelId: string) => unknown
  onSelectModel: (id: string) => void
  onModelMouseEnter: (connectionId: string, modelId: string) => void
  onModelMouseLeave: () => void
  renameLabel: string
  setRenameLabel: (label: string) => void
  onAddApiKey: (
    provider: ProviderEntry,
    label: string,
    apiKey: string,
    opts?: { extraKeys?: string[] },
  ) => Promise<void>
  onAddOAuth: (
    provider: ProviderEntry,
    label: string,
  ) => ReturnType<ReturnType<typeof useConnections>['addOAuthConnection']>
}

/** The model column: favorites, recents, a connection's models, its settings, or the add form. */
export function ModelBrowserMainPanel(props: ModelBrowserMainPanelProps) {
  const {
    detailsView,
    selectedItem,
    selectedConn,
    editMode,
    setEditMode,
    searchToolbar,
    nav,
    paging,
    shortlists,
    connectionsState,
    currentConnectionId,
    currentModelId,
    pickModel,
    onModelMouseEnter,
    onModelMouseLeave,
  } = props
  const { isFavorite, toggleFav } = shortlists
  const crossList = (kind: 'favorite' | 'recent') => (
    <CrossConnectionModelList
      searchToolbar={searchToolbar()}
      nav={nav}
      totalCount={kind === 'favorite' ? shortlists.favoriteCount : shortlists.recentCount}
      title={kind === 'favorite' ? 'Favorites' : 'Recent'}
      emptyLabel={kind === 'favorite' ? 'No favorite models yet' : 'No recent models yet'}
      items={kind === 'favorite' ? shortlists.resolvedFavorites : shortlists.resolvedRecent}
      selectedConnectionId={currentConnectionId}
      selectedModelId={currentModelId}
      onSelect={(connectionId, id) => void pickModel(connectionId, id)}
      onModelMouseEnter={onModelMouseEnter}
      onModelMouseLeave={onModelMouseLeave}
      isFavorite={isFavorite}
      onToggleFavorite={toggleFav}
    />
  )

  return (
    <div
      data-slot="model-browser-main-panel"
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
        detailsView && 'max-lg:hidden',
      )}
    >
      {/* ── Favorite / recent models (cross-connection) ── */}
      {selectedItem?.type === 'favorite' && crossList('favorite')}
      {selectedItem?.type === 'recent' && crossList('recent')}

      {/* ── Model list ── */}
      {selectedItem?.type === 'connection' && selectedConn?.hasApiKey && !editMode && (
        <ConnectionModelList
          searchToolbar={searchToolbar(
            <ModelFilterMenu
              available={paging.availableFilters}
              active={paging.filters}
              onToggle={paging.toggleFilter}
              onClear={paging.clearFilters}
            />,
          )}
          nav={nav}
          totalCount={paging.connectionModels.length}
          selectedConn={selectedConn}
          detailsPinned={props.detailsPinned}
          onToggleDetails={() => props.setDetailsPinned((v) => !v)}
          onOpenDetailsView={() => props.setDetailsView(true)}
          onOpenSettings={() => setEditMode(true)}
          filteredModels={paging.filteredModels}
          visibleModels={paging.visibleModels}
          visibleCount={paging.visibleCount}
          sentinelRef={paging.sentinelRef}
          selectedValue={props.selectedValue}
          prepend={props.resetRow}
          onSelectModel={props.onSelectModel}
          onModelMouseEnter={(id) => onModelMouseEnter(selectedConn.id, id)}
          onModelMouseLeave={onModelMouseLeave}
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
            connections={connectionsState.connections}
            allProviders={props.allProviders}
            renameLabel={props.renameLabel}
            setRenameLabel={props.setRenameLabel}
            updateLabel={connectionsState.updateLabel}
            addKey={connectionsState.addKey}
            removeKey={connectionsState.removeKey}
            updateKey={connectionsState.updateKey}
            remove={connectionsState.remove}
            onExitEdit={() => setEditMode(false)}
            setSelectedItem={props.setSelectedItem}
          />
        )}

      {/* ── Add provider form ── */}
      {selectedItem?.type === 'provider' && <AddProviderPanel {...props} id={selectedItem.id} />}

      {/* ── Empty state ── */}
      {!selectedItem && (
        <div className="flex min-h-0 flex-1 flex-col">
          <PanelHeader tone="content" title={<PickerPanelTitle title="Models" nav={nav} />} />
          <EmptyHint className="flex-1 px-6 text-2xs">
            Pick a connection, or add a provider.
          </EmptyHint>
        </div>
      )}
    </div>
  )
}

function AddProviderPanel({
  id,
  nav,
  allProviders,
  oauthProviderIds,
  oauthProviders,
  setEditMode,
  onAddApiKey,
  onAddOAuth,
}: ModelBrowserMainPanelProps & { id: string }) {
  const p = allProviders.find((prov) => prov.id === id)
  if (!p) return null
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <AddConnectionForm
        nav={nav}
        provider={p}
        isOAuth={oauthProviderIds.includes(p.id)}
        oauthLabel={oauthProviders.find((o) => o.providerId === p.id)?.loginLabel}
        oauthDescription={oauthProviders.find((o) => o.providerId === p.id)?.loginDescription}
        onAdded={() => setEditMode(false)}
        onAddApiKey={(label, apiKey, opts) => {
          void onAddApiKey(p, label, apiKey, opts)
        }}
        onAddOAuth={(label) => onAddOAuth(p, label)}
      />
    </div>
  )
}
