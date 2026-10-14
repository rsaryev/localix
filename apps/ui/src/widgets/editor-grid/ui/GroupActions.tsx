import { PanelRight, PanelRightDashed, RotateCcw } from 'lucide-react'
import { leafIds, useGridStore } from '@/features/workspace-grid/model'
import { CMD } from '@/shared/lib/keybindings/catalog'
import { useChordHint } from '@localixai/kit/keybindings'
import { IconButton } from '@localixai/kit/icon-button'

/**
 * The actions of a GROUP of tabs, at the right end of its tab strip, level with the tabs — so they
 * act on the panel as a whole, whatever tab it shows: a chat, a file, a plugin.
 *
 * One action for now: fill the workbench with this group, or give the space back. It is the grid's
 * own maximize (`maximizeGroup`) and the "Maximize editor group" command's, so the shortcut, the
 * command and the button always agree; the tooltip names the shortcut as the person bound it.
 * With a single group there is nothing to fill over, so the button stays in place but disabled —
 * a control that moves in and out of the strip reads as broken.
 *
 * A plain icon button with a panel glyph, like the app's other frame controls; maximized, the other
 * side of the glyph turns dashed — that panel is hidden.
 */
export function GroupActions({ groupId }: { groupId: string }) {
  const maximized = useGridStore((s) => s.maximizedGroup === groupId)
  const split = useGridStore((s) => leafIds(s.root).length > 1)
  const hint = useChordHint()

  const label = maximized
    ? 'Restore layout'
    : split
      ? 'Maximize panel'
      : 'Maximize panel — the only panel'
  return (
    <>
      <IconButton
        aria-label="Arrange panels"
        tooltip="Arrange panels · keep all tabs open"
        tooltipSide="bottom"
        size="sm"
        disabled={!split && !maximized}
        onClick={() => useGridStore.getState().arrangePanels()}
      >
        <RotateCcw />
      </IconButton>
      <IconButton
        aria-label={label}
        tooltip={hint(label, CMD.toggleEditorMaximize)}
        tooltipSide="bottom"
        size="sm"
        className="mr-1"
        aria-pressed={maximized}
        disabled={!split && !maximized}
        onClick={() => useGridStore.getState().maximizeGroup(groupId)}
      >
        {maximized ? <PanelRightDashed /> : <PanelRight />}
      </IconButton>
    </>
  )
}
