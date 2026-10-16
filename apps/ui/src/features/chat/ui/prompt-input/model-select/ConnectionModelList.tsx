import type { ReactNode } from 'react'
import { Info, Settings } from 'lucide-react'
import { CommandEmpty, CommandGroup, CommandList } from '@localixai/kit/command'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import { IconButton } from '@localixai/kit/icon-button'
import { PanelHeader } from '@localixai/kit/panel-header'
import type { CatalogModel } from '@localixai/agent/catalog'
import type { ProviderConnection } from '@/shared/api/contracts'
import { ModelListItem } from './ModelListItem'
import { PickerPanelTitle } from './PickerPanelTitle'
import { modelCountLabel } from './filterModels'
import { PICKER_LIST, PICKER_ROW_META } from './pickerRow'

interface ConnectionModelListProps {
  /** The search band (search + filter menu), rendered under the header. */
  searchToolbar: ReactNode
  /** The narrow layout's workload/provider switcher; it takes the title's place below md. */
  nav?: ReactNode
  /** How many models the connection offers before search and filters narrow them. */
  totalCount: number
  selectedConn: ProviderConnection
  detailsPinned: boolean
  onToggleDetails: () => void
  /** Below lg there is no details column: this opens the details in place of the list. */
  onOpenDetailsView: () => void
  onOpenSettings: () => void
  filteredModels: CatalogModel[]
  visibleModels: CatalogModel[]
  visibleCount: number
  sentinelRef: (node: HTMLElement | null) => void
  selectedValue: string
  onSelectModel: (id: string) => void
  onModelMouseEnter: (id: string) => void
  onModelMouseLeave: () => void
  /** Whether a model id (on the previewed connection) is favorited — drives the star fill. */
  isFavorite: (id: string) => boolean
  onToggleFavorite: (id: string) => void
  /** Optional row rendered above the model list (e.g. the aux "Use session model" reset). */
  prepend?: ReactNode
}

/**
 * Connection model-list panel of the picker: the column header (connection name, count,
 * details toggle, settings), the search band, and the infinite-scrolling model list.
 * Props in, callbacks out, no own state.
 */
export function ConnectionModelList({
  searchToolbar,
  nav,
  totalCount,
  selectedConn,
  detailsPinned,
  onToggleDetails,
  onOpenDetailsView,
  onOpenSettings,
  filteredModels,
  visibleModels,
  visibleCount,
  sentinelRef,
  selectedValue,
  onSelectModel,
  onModelMouseEnter,
  onModelMouseLeave,
  isFavorite,
  onToggleFavorite,
  prepend,
}: ConnectionModelListProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PanelHeader
        tone="content"
        title={<PickerPanelTitle title={selectedConn.label} nav={nav} />}
        summary={
          <span className={PICKER_ROW_META}>
            {modelCountLabel(filteredModels.length, totalCount)}
          </span>
        }
        actionsLabel={`${selectedConn.label} actions`}
        actions={
          <>
            {/* Two buttons for one meaning, split by width: from lg it toggles the details
                column, below lg it opens the details where the list is. */}
            <IconButton
              size="sm"
              aria-label={detailsPinned ? 'Hide model details' : 'Show model details'}
              aria-pressed={detailsPinned}
              onClick={onToggleDetails}
              tooltip={detailsPinned ? 'Hide model details' : 'Show model details'}
              className="max-lg:hidden"
            >
              <Info />
            </IconButton>
            <IconButton
              size="sm"
              aria-label="Model details and settings"
              onClick={onOpenDetailsView}
              tooltip="Model details and settings"
              className="lg:hidden"
            >
              <Info />
            </IconButton>
            <IconButton
              size="sm"
              aria-label="Open connection settings"
              onClick={onOpenSettings}
              tooltip="Connection settings"
            >
              <Settings />
            </IconButton>
          </>
        }
      />
      {searchToolbar}

      <CommandList className="scrollbar-thin max-h-full min-h-0 flex-1 overflow-y-auto">
        <CommandEmpty className="py-6 text-center text-xs text-text-soft">
          No models found
        </CommandEmpty>
        <CommandGroup className={PICKER_LIST}>
          {prepend}
          {visibleModels.map((m) => (
            <ModelListItem
              key={m.id}
              model={m}
              selected={selectedValue === m.id}
              onSelect={() => onSelectModel(m.id)}
              onMouseEnter={() => onModelMouseEnter(m.id)}
              onMouseLeave={onModelMouseLeave}
              favorited={isFavorite(m.id)}
              onToggleFavorite={() => onToggleFavorite(m.id)}
            />
          ))}
          {visibleCount < filteredModels.length && (
            <div ref={sentinelRef} className="flex justify-center py-2 text-2xs text-text-soft">
              <ActivitySignal label="Loading more" />
            </div>
          )}
        </CommandGroup>
      </CommandList>
    </div>
  )
}
