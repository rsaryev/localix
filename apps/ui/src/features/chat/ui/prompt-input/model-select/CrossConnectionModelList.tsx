import type { ReactNode } from 'react'
import { CommandGroup, CommandList } from '@localixai/kit/command'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { PanelHeader } from '@localixai/kit/panel-header'
import type { CatalogModel } from '@localixai/agent/catalog'
import { ModelListItem } from './ModelListItem'
import { PickerPanelTitle } from './PickerPanelTitle'
import { modelCountLabel } from './filterModels'
import { PICKER_LIST, PICKER_ROW_META } from './pickerRow'

/** A model entry resolved against the live connections + catalog. */
export interface ResolvedModelEntry {
  connectionId: string
  providerId: string
  connectionLabel: string
  model: CatalogModel
}

interface CrossConnectionModelListProps {
  /** The search band, rendered under the header. */
  searchToolbar: ReactNode
  /** The narrow layout's workload/provider switcher; it takes the title's place below md. */
  nav?: ReactNode
  /** How many entries the list holds before search narrows it. */
  totalCount: number
  title: string
  emptyLabel: string
  items: ResolvedModelEntry[]
  /** (connectionId, modelId) of the currently-selected slot — drives the check. */
  selectedConnectionId: string | null
  selectedModelId: string
  onSelect: (connectionId: string, modelId: string) => void
  onModelMouseEnter: (connectionId: string, modelId: string) => void
  onModelMouseLeave: () => void
  /** Whether a (connectionId, modelId) pair is favorited — drives the star fill. */
  isFavorite: (connectionId: string, modelId: string) => boolean
  onToggleFavorite: (connectionId: string, modelId: string) => void
}

/**
 * A cross-connection model panel of the picker (Recent / Favorites) — the rows span
 * connections, so each names its connection on the right. Same header and search band as a
 * single connection's list, so switching between them moves nothing.
 */
export function CrossConnectionModelList({
  searchToolbar,
  nav,
  totalCount,
  title,
  emptyLabel,
  items,
  selectedConnectionId,
  selectedModelId,
  onSelect,
  onModelMouseEnter,
  onModelMouseLeave,
  isFavorite,
  onToggleFavorite,
}: CrossConnectionModelListProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PanelHeader
        tone="content"
        title={<PickerPanelTitle title={title} nav={nav} />}
        summary={
          <span className={PICKER_ROW_META}>{modelCountLabel(items.length, totalCount)}</span>
        }
      />
      {searchToolbar}
      {items.length === 0 ? (
        <EmptyHint className="flex-1 text-xs">{emptyLabel}</EmptyHint>
      ) : (
        <CommandList className="scrollbar-thin max-h-full min-h-0 flex-1 overflow-y-auto">
          <CommandGroup className={PICKER_LIST}>
            {items.map((item) => (
              <ModelListItem
                key={`${item.connectionId} ${item.model.id}`}
                value={`${item.connectionId} ${item.model.id}`}
                model={item.model}
                secondary={item.connectionLabel}
                selected={
                  item.model.id === selectedModelId && item.connectionId === selectedConnectionId
                }
                onSelect={() => onSelect(item.connectionId, item.model.id)}
                onMouseEnter={() => onModelMouseEnter(item.connectionId, item.model.id)}
                onMouseLeave={onModelMouseLeave}
                favorited={isFavorite(item.connectionId, item.model.id)}
                onToggleFavorite={() => onToggleFavorite(item.connectionId, item.model.id)}
              />
            ))}
          </CommandGroup>
        </CommandList>
      )}
    </div>
  )
}
