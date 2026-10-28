import { MenuEntries } from '@localixai/kit/menu-entries'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'

/**
 * The terminal's right-click rows, built when the menu opens.
 *
 * Two rows depend on state xterm owns and React never sees (is anything selected right now),
 * so the list must be built by the content that mounts on open, not by the pane that renders
 * on every keystroke: a list built with the pane offers Copy over a selection made since.
 */
export function TerminalContextMenuEntries({ build }: { build: () => MenuEntry[] }) {
  return <MenuEntries entries={build()} family="context" />
}
