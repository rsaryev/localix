import { useState } from 'react'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { PanelHeader } from '@localixai/kit/panel-header'
import { SearchInput } from '@localixai/kit/search-input'
import { Button } from '@localixai/kit/button'
import { PLUGIN_CATEGORIES, type PluginCategory } from '@localixai/plugin-sdk/manifest'
import { copyText } from '@localixai/plugin-sdk/ui/interactions'
import type { RailEntry } from './shellTypes'
import { CapabilityViewRow } from './CapabilityViewRow'
import { pluginEntryMenuEntries } from './pluginEntryMenu'

/** Above this many rows the list is long enough to be worth filtering. */
const FILTER_THRESHOLD = 8
const CATEGORY_LABELS: Record<PluginCategory | 'other', string> = {
  development: 'Development',
  data: 'Data',
  content: 'Content',
  utilities: 'Utilities',
  games: 'Games',
  other: 'Other',
}
const CATEGORY_ORDER = [...PLUGIN_CATEGORIES, 'other'] as const

function groupEntries(
  entries: readonly RailEntry[],
  categories?: ReadonlyMap<string, PluginCategory | undefined>,
) {
  const buckets = new Map<(typeof CATEGORY_ORDER)[number], RailEntry[]>()
  for (const entry of entries) {
    const category = (entry.pluginName && categories?.get(entry.pluginName)) || 'other'
    const bucket = buckets.get(category) ?? []
    bucket.push(entry)
    buckets.set(category, bucket)
  }
  return CATEGORY_ORDER.flatMap((category) => {
    const items = buckets.get(category)
    return items?.length ? [{ category, label: CATEGORY_LABELS[category], entries: items }] : []
  })
}

interface PluginsSidebarProps {
  /** True while the enabled-view set is still loading. */
  pending?: boolean
  /** This scope's plugin-owned views — one openable row each. */
  entries: RailEntry[]
  /** Manifest category by plugin name. Older and third-party manifests fall under Other. */
  categories?: ReadonlyMap<string, PluginCategory | undefined>
  manageUri?: string
  /** Deep link to one plugin's row in Settings — the row menu's "Plugin settings…". */
  pluginSettingsUri?: (pluginName: string) => string
  /** Views currently in the rail's recent slots; their row menu offers removing them. */
  recentIds?: ReadonlySet<string>
  onRemoveRecent?: (id: string) => void
  /** Asks, then removes an installed plugin — the row menu's "Uninstall…". */
  onUninstallPlugin?: (pluginName: string) => void
  canUninstallPlugin?: (pluginName: string) => boolean
  onNavigateUi?: (uri: string) => void
}

const copy = (text: string, label: string) => void copyText(text, label)

/**
 * The workspace's plugin launcher: one row per view a plugin contributes, click to open it.
 *
 * It used to be a second Capabilities screen — the same plugins with their switches, every
 * built-in tool, and flat Agents / MCP / Skills groups, each with a toggle. That duplicated
 * Settings row for row while answering a different question badly: a launcher is for
 * REACHING something, and availability is decided per scope, which a rail panel floating
 * beside a chat has no scope picker to express. Switches live in Settings → Capabilities,
 * one click away via Manage.
 *
 * Nothing here arranges the rail. Plugin views are not pinnable — the rail floats the ones
 * you actually open into its recent slots on its own.
 *
 * Each row carries the standard row menu (right-click or its hover action button): open,
 * jump to the plugin's own row in Settings, drop it from the recents, copy its link or name,
 * uninstall it.
 */
export function PluginsSidebar({
  pending = false,
  entries,
  categories,
  manageUri,
  pluginSettingsUri,
  recentIds,
  onRemoveRecent,
  onUninstallPlugin,
  canUninstallPlugin,
  onNavigateUi,
}: PluginsSidebarProps) {
  const [query, setQuery] = useState('')
  const term = query.trim().toLowerCase()
  const visible = term
    ? entries.filter((entry) => {
        const category = (entry.pluginName && categories?.get(entry.pluginName)) || 'other'
        return (
          entry.label.toLowerCase().includes(term) ||
          CATEGORY_LABELS[category].toLowerCase().includes(term)
        )
      })
    : entries
  const groups = groupEntries(visible, categories)

  // Keeps its `bg-sidebar` coat: this is the sidebar panel's own outermost painter inside the
  // chrome column, and `scripts/pane-ground-guard.test.ts` allowlists it as such. Anything
  // mounted INSIDE it inherits this ground rather than painting a second, compounding coat.
  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <PanelHeader
        title="Plugins"
        tone="sidebar"
        actions={
          manageUri && onNavigateUi ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onNavigateUi(manageUri)}
              className="text-text-soft hover:text-foreground"
            >
              Manage
            </Button>
          ) : null
        }
      />
      {entries.length > FILTER_THRESHOLD ? (
        <div className="shrink-0 px-2 pt-1.5">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder="Filter…"
            size="md"
            tone="sidebar"
            inset
          />
        </div>
      ) : null}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1.5">
        {/* A plugin-owned view is invisible until the API publishes the enabled set (the
          registries fail closed). Saying "loading" keeps a still-loading panel
          distinguishable from one that genuinely has nothing. */}
        {pending && entries.length === 0 ? (
          <LoadingHint className="h-auto p-4 text-xs">Loading plugins</LoadingHint>
        ) : entries.length === 0 ? (
          <EmptyHint className="h-auto p-4 text-xs">No plugin views are available.</EmptyHint>
        ) : visible.length === 0 ? (
          <EmptyHint className="h-auto p-4 text-xs">No plugin matches “{query.trim()}”.</EmptyHint>
        ) : null}
        {groups.map((group, index) => (
          <section key={group.category} aria-label={group.label}>
            <div
              className={`px-2 pb-1 text-2xs font-medium uppercase tracking-wide text-sidebar-foreground/40 ${index === 0 ? 'pt-1' : 'pt-3'}`}
            >
              {group.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.entries.map((entry) => (
                <CapabilityViewRow
                  key={entry.id}
                  entry={entry}
                  menu={pluginEntryMenuEntries(entry, {
                    settingsUri: pluginSettingsUri,
                    onNavigateUi,
                    isRecent: recentIds?.has(entry.id),
                    onRemoveRecent,
                    copyText: copy,
                    onUninstall: onUninstallPlugin,
                    canUninstall: canUninstallPlugin,
                  })}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
