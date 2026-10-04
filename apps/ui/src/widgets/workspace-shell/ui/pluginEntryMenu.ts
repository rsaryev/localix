import { ExternalLink, History, Link2, Settings2, Tag, Trash2 } from 'lucide-react'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import type { RailEntry } from './shellTypes'

/**
 * Everything you can do to one plugin view from the launcher, described once.
 *
 * The row offers it two ways — its hover action button and a right-click anywhere on the row —
 * so the two cannot drift (see `sessionMenuEntries`). Rows the entry cannot honour are left
 * out rather than disabled: a launcher row with no resource URI has nothing to copy, and a view
 * that is not in the rail's recent slots has nothing to remove.
 *
 * No enable/disable switch: availability is decided per scope, and Settings is where the scope
 * is chosen. "Plugin settings…" lands on this plugin's row there.
 *
 * Uninstall is the one row shown DISABLED rather than left out: a built-in plugin cannot be
 * removed, and a missing row would read as "this menu forgot it" rather than "not this one".
 */
export interface PluginEntryMenuOps {
  /** Deep link to this plugin's row in Settings → Capabilities → Plugins. */
  settingsUri?: (pluginName: string) => string
  onNavigateUi?: (uri: string) => void
  /** True when the view currently occupies one of the rail's recent slots. */
  isRecent?: boolean
  onRemoveRecent?: (id: string) => void
  copyText: (text: string, label: string) => void
  /** Asks, then removes the installed plugin. Absent → no Uninstall row at all. */
  onUninstall?: (pluginName: string) => void
  /** False for a bundled plugin: its row stays, disabled, saying why. */
  canUninstall?: (pluginName: string) => boolean
}

export function pluginEntryMenuEntries(entry: RailEntry, ops: PluginEntryMenuOps): MenuEntry[] {
  const { pluginName, resourceUri } = entry
  const settingsUri = pluginName && ops.settingsUri ? ops.settingsUri(pluginName) : undefined
  const navigate = ops.onNavigateUi
  const removeRecent = ops.onRemoveRecent
  const uninstall = ops.onUninstall
  const uninstallable = pluginName ? (ops.canUninstall?.(pluginName) ?? true) : false
  return [
    { id: 'open', label: 'Open', icon: ExternalLink, onSelect: () => entry.onClick() },
    ...(settingsUri && navigate
      ? [
          {
            id: 'settings',
            label: 'Plugin settings…',
            icon: Settings2,
            onSelect: () => navigate(settingsUri),
          },
        ]
      : []),
    ...(ops.isRecent && removeRecent
      ? [
          {
            id: 'remove-recent',
            label: 'Remove from recents',
            icon: History,
            onSelect: () => removeRecent(entry.id),
          },
        ]
      : []),
    { separator: true },
    ...(resourceUri
      ? [
          {
            id: 'copy-link',
            label: 'Copy link',
            icon: Link2,
            onSelect: () => ops.copyText(resourceUri, 'Plugin link'),
          },
        ]
      : []),
    ...(pluginName
      ? [
          {
            id: 'copy-name',
            label: 'Copy plugin name',
            icon: Tag,
            hint: pluginName,
            onSelect: () => ops.copyText(pluginName, 'Plugin name'),
          },
        ]
      : []),
    ...(pluginName && uninstall
      ? [
          { separator: true } as const,
          {
            id: 'uninstall',
            label: 'Uninstall…',
            icon: Trash2,
            danger: true,
            disabled: !uninstallable,
            ...(uninstallable ? {} : { description: 'Built-in — turn it off in Settings instead' }),
            onSelect: () => uninstall(pluginName),
          },
        ]
      : []),
  ]
}
