/**
 * Open a link the terminal produced: a `file:line` goes to the editor grid, a URL to the
 * browser. Shared by the pane's link provider and the link quickpick so both halves of the
 * same affordance route identically.
 *
 * A file link opens in the grid of the chat the TERMINAL belongs to. Opened in the chat on
 * screen instead, a path printed by a background chat's build landed in another chat's
 * workspace, where it resolved against the wrong root or not at all.
 */
import { openFileInGrid } from '@/shared/lib/recentFiles'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import type { TerminalLinkItem } from './terminalLinks'

export function openTerminalLink(sessionId: string, item: TerminalLinkItem): void {
  if (item.kind === 'file')
    openFileInGrid({
      sessionId,
      path: item.path,
      ...(item.line !== undefined ? { line: item.line } : {}),
    })
  else platformCapabilities().external.open(item.url)
}
