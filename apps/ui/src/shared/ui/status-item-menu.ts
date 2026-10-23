import { Settings2 } from 'lucide-react'
import type { MenuEntry, StatusItemState } from '@localixai/mini-app-sdk/ui'

import { inspector } from '@/shared/lib/inspectorBus'
import { navigateSettings } from '@/shared/lib/settingsNavBus'

/**
 * THE menu behind every contributed status item, wherever it is reached from.
 *
 * A plugin glyph in the chrome had one of three behaviours depending on what its author happened
 * to declare: a menu on right-click, a menu on left-click, or nothing at all. From the user's
 * chair those are not three designs, they are one design that works on some icons — and the icon
 * that does nothing on right-click is indistinguishable from a plugin that broke.
 *
 * So the HOST owns the menu's shape and every item has one:
 *
 *     <the plugin's own entries, or its primary action when it declared none>
 *     ───────────────────────────
 *     Plugin settings…
 *
 * The trailing row is the uniform half. It is the same on all eleven contributing plugins, it is
 * where "how do I turn this off" is answered, and it is the reason a right-click is worth trying
 * on an item whose author declared nothing at all.
 *
 * The plugin's own entries always come FIRST: the host's row is an escape hatch, and an escape
 * hatch above the actions is a menu that reads as the host's rather than the plugin's.
 */

/** Reveal the Plugins tab of Settings — the one place every plugin is configured and disabled. */
export function openPluginSettings(): void {
  // Open first, then navigate: `navigateSettings` latches its target, so the panel applies it
  // whether it mounts before or after this call.
  inspector.openSettings()
  navigateSettings('plugins')
}

/** The host capabilities the menu offers — injected so the shape is testable without the shell. */
export interface StatusItemMenuHost {
  openPluginSettings: () => void
}

const DEFAULT_HOST: StatusItemMenuHost = { openPluginSettings }

/**
 * The PLUGIN's half of one item's menu — its own entries, or the primary action synthesised for an
 * item that declared none.
 *
 * Exported because more than one surface needs to know where the plugin's offer ends and the
 * host's begins, and the alternative was measuring it: the titlebar's overflow menu looked for the
 * first separator and called everything above it "the plugin's". That is true only of a plugin
 * whose menu has ONE section — every plugin with a section of its own (Git, Reader, Database, API,
 * Learning, Trading) had its whole list silently dropped the moment its glyph stopped fitting, and
 * the row that replaced it looked like a working row.
 *
 * The primary action is synthesised ONLY for an item that declared no menu. Every plugin that
 * declares one already opens with its own "Open …" row, and a host-added duplicate above it would
 * say the same thing twice in the app's most repeated menu.
 */
export function pluginMenuEntries(state: StatusItemState): MenuEntry[] {
  if (state.menu && state.menu.length > 0) return [...state.menu]
  if (!state.onClick) return []
  return [
    {
      id: 'status-item:primary',
      label: state.label,
      ...(state.Icon ? { icon: state.Icon } : {}),
      ...(state.chordId ? { chordId: state.chordId } : {}),
      onSelect: state.onClick,
    },
  ]
}

/** Build one item's effective menu: the plugin's half, then the host's uniform trailing row. */
export function statusItemMenuEntries(
  state: StatusItemState,
  host: StatusItemMenuHost = DEFAULT_HOST,
): MenuEntry[] {
  const own = pluginMenuEntries(state)
  return [
    ...own,
    ...(own.length > 0 ? ([{ separator: true }] satisfies MenuEntry[]) : []),
    {
      id: 'status-item:plugin-settings',
      label: 'Plugin settings…',
      icon: Settings2,
      onSelect: host.openPluginSettings,
    },
  ]
}
