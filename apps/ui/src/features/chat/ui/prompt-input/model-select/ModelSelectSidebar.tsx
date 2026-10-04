import { Clock, KeyRound, LogIn, Star } from 'lucide-react'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { StatusDot } from '@localixai/kit/status-dot'
import { PanelHeader } from '@localixai/kit/panel-header'
import { SearchInput } from '@localixai/kit/search-input'
import { SectionLabel } from '@localixai/kit/section-label'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import type { ProviderEntry } from '@localixai/agent/catalog'
import type { ProviderConnection } from '@/shared/api/contracts'
import {
  PICKER_LIST,
  PICKER_ROW_LEADING,
  PICKER_ROW_META,
  PICKER_SECTION_LABEL,
  pickerColumnFrame,
  pickerRow,
  type PickerColumnLayout,
} from './pickerRow'

/** Sentinel id for the cross-connection "Recent" row. */
export const RECENT_ITEM_ID = '__recent__'
/** Sentinel id for the cross-connection "Favorites" row. */
export const FAVORITE_ITEM_ID = '__favorite__'

/** Which row in the picker is being previewed — favorites, recent, an active connection, or a provider to add. */
export type SelectedItem = {
  type: 'connection' | 'provider' | 'recent' | 'favorite'
  id: string
} | null

interface ModelSelectSidebarProps {
  connections: ProviderConnection[]
  selectedItem: SelectedItem
  setSelectedItem: (item: SelectedItem) => void
  selectedConn: ProviderConnection | null
  activeId: string | null
  providerCounts: Record<string, number>
  /** Connectable providers, already narrowed by `providerSearch`. */
  filteredUnconnectedProviders: ProviderEntry[]
  oauthIdSet: ReadonlySet<string>
  /** Number of recent models — the "Recent" row is hidden when zero. */
  recentCount: number
  /** Number of favorite models — the "Favorites" row is hidden when zero. */
  favoriteCount: number
  /** The rail's own filter. It narrows providers only, never the model list beside it. */
  providerSearch: string
  onProviderSearchChange: (value: string) => void
  /** `column` in the drawer from md up; `sheet` inside the narrow layout's provider switcher. */
  layout?: PickerColumnLayout
}

/**
 * How a connection row says its state, in the leading slot every row shares.
 *
 * A dot rather than a trailing badge: the rail's rows then all begin with a 16px glyph — a star,
 * a clock, a dot, a sign-in mark — so their names start on one vertical instead of shifting by
 * whatever each kind of row happened to carry on its left.
 */
function connectionDot(connection: ProviderConnection, activeId: string | null) {
  if (!connection.hasApiKey)
    return <StatusDot label="Credentials unavailable" className="bg-status-warning" />
  if (connection.id === activeId) return <StatusDot label="Active" className="bg-status-success" />
  return <StatusDot label="Connected" className="bg-text-faint opacity-60" />
}

/**
 * The provider column of the model picker: shortcuts, active connections and the add-provider
 * list, under its own search. Selection is preview-only — clicking a row shows its models; the
 * active provider/model only changes on a model click.
 *
 * The search lives HERE, not in the model column. It used to be one field shared by both, so a
 * query typed to find a model also emptied the add-provider list, and a provider form carried a
 * search box that filtered a different column than the one it sat in.
 */
export function ModelSelectSidebar({
  connections,
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
  onProviderSearchChange,
  layout = 'column',
}: ModelSelectSidebarProps) {
  const query = providerSearch.trim().toLowerCase()
  const searching = query.length > 0
  // A search finds a provider wherever it is listed: connected ones match by label as well.
  const shownConnections = searching
    ? connections.filter(
        (c) => c.label.toLowerCase().includes(query) || c.providerId.toLowerCase().includes(query),
      )
    : connections
  const nothingMatches =
    searching && shownConnections.length === 0 && filteredUnconnectedProviders.length === 0
  return (
    <div className={pickerColumnFrame(layout, 'w-48 lg:w-52 xl:w-58')}>
      {layout === 'column' && <PanelHeader tone="content" title="Provider" />}
      <WorkbenchToolbar aria-label="Provider search">
        <SearchInput
          size="md"
          inset
          className="flex-1"
          aria-label="Search providers"
          placeholder="Search providers…"
          value={providerSearch}
          onValueChange={onProviderSearchChange}
          // The rail search drives no cmdk list: arrows and Enter must not reach the model
          // column's option collection through the shared Command root.
          onKeyDown={(event) => event.stopPropagation()}
        />
      </WorkbenchToolbar>
      <div className={cn(PICKER_LIST, 'scrollbar-thin min-h-0 flex-1 overflow-y-auto')}>
        {/* Shortcuts across connections. A search hides them: it asks for a provider. */}
        {!searching && favoriteCount > 0 && (
          <button
            type="button"
            onClick={() => setSelectedItem({ type: 'favorite', id: FAVORITE_ITEM_ID })}
            title="Favorite models"
            className={pickerRow(selectedItem?.type === 'favorite')}
          >
            <span className={PICKER_ROW_LEADING}>
              <Star className="size-3.5 text-status-warning" />
            </span>
            <span className="min-w-0 flex-1 truncate">Favorites</span>
            <span className={PICKER_ROW_META}>{favoriteCount}</span>
          </button>
        )}
        {!searching && recentCount > 0 && (
          <button
            type="button"
            onClick={() => setSelectedItem({ type: 'recent', id: RECENT_ITEM_ID })}
            title="Recently used models"
            className={pickerRow(selectedItem?.type === 'recent')}
          >
            <span className={PICKER_ROW_LEADING}>
              <Clock className="size-3.5 text-text-faint" />
            </span>
            <span className="min-w-0 flex-1 truncate">Recent</span>
            <span className={PICKER_ROW_META}>{recentCount}</span>
          </button>
        )}

        {shownConnections.length > 0 && (
          <>
            <SectionLabel weight="semibold" className={PICKER_SECTION_LABEL}>
              Connections
            </SectionLabel>
            {shownConnections.map((c) => (
              <button
                key={c.id}
                type="button"
                // Clicking a connection only previews its models — it does NOT
                // switch the active provider/model. That happens on model click.
                onClick={() => setSelectedItem({ type: 'connection', id: c.id })}
                title={c.label}
                className={pickerRow(
                  selectedItem?.type === 'connection' && selectedItem.id === c.id,
                )}
              >
                <span className={PICKER_ROW_LEADING}>{connectionDot(c, activeId)}</span>
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.hasApiKey && (
                  <span className={PICKER_ROW_META}>{providerCounts[c.providerId] || 0}</span>
                )}
              </button>
            ))}
          </>
        )}

        {filteredUnconnectedProviders.length > 0 && (
          <>
            <SectionLabel weight="semibold" className={PICKER_SECTION_LABEL}>
              Add provider
            </SectionLabel>
            {filteredUnconnectedProviders.map((p) => {
              const isActive =
                (selectedItem?.type === 'provider' && selectedItem.id === p.id) ||
                (selectedItem?.type === 'connection' && selectedConn?.providerId === p.id)
              const oauth = oauthIdSet.has(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedItem({ type: 'provider', id: p.id })}
                  title={oauth ? `${p.name} · sign in` : `${p.name} · API key`}
                  className={pickerRow(isActive)}
                >
                  <span className={cn(PICKER_ROW_LEADING, 'text-text-faint')}>
                    {oauth ? <LogIn className="size-3.5" /> : <KeyRound className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                </button>
              )
            })}
          </>
        )}
        {nothingMatches && (
          <EmptyHint className="h-auto px-1.5 py-4 text-2xs">No providers match</EmptyHint>
        )}
      </div>
    </div>
  )
}
