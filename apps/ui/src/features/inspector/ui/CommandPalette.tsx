import { useEffect, useMemo, useRef, useState } from 'react'
import { SquareTerminal } from 'lucide-react'
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@localixai/kit/command'
import { CommandHints } from '@/shared/ui/command-hints'
import { ChordHint } from '@localixai/kit/chord-hint'
import { getPaletteMru, recordPaletteUse } from '@/shared/lib/paletteMru'
import { uiCommandUri, type PaletteCommand } from '@/shared/contrib/uiCommands'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { invokeUi } from '@/shared/lib/uiNavigation'
import { buildCommandPaletteSections } from '../model/commandPaletteSections'
import { subscribeUiOverlay } from '@/shared/lib/uiOverlayBus'
import { COMMAND_PALETTE_OVERLAY_ID } from './CommandPalette.surface'

/**
 * `chordId` is a keybinding-registry command id; when present, its live chord
 * is shown on the right and stays in sync with user rebinds.
 */
interface CommandPaletteProps {
  /** The chat the palette acts for — a picked command that opens something opens it there.
   *  `null` when no chat is open: such a command then opens nothing chat-scoped. */
  sessionId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: PaletteCommand[]
}

/**
 * ⌘⇧P / Ctrl+Shift+P command palette. Lists every workspace
 * command by name — the same actions the keyboard shortcuts trigger — and runs
 * the pick, so nothing is gated behind remembering a chord. Each row shows its
 * live keybinding (resolved through the registry, so a rebind reflects here).
 * cmdk owns the fuzzy filtering; picking a command closes the palette first,
 * then runs the action on the next tick so it can open another dialog cleanly.
 */
export function CommandPalette({ sessionId, open, onOpenChange, commands }: CommandPaletteProps) {
  const navigation = useUiNavigation({ sessionId })
  const [query, setQuery] = useState('')
  const [mru, setMru] = useState<string[]>([])
  const requestedQuery = useRef<string | null>(null)

  useEffect(
    () =>
      subscribeUiOverlay(COMMAND_PALETTE_OVERLAY_ID, (params) => {
        const query = typeof params.query === 'string' ? params.query : ''
        requestedQuery.current = query
        if (open) {
          setQuery(query)
          requestedQuery.current = null
        }
        onOpenChange(true)
      }),
    [onOpenChange, open],
  )

  // Reset the query and re-read the MRU history each time the palette opens so a
  // stale filter never lingers and the "Recently used" section reflects the
  // latest picks (including ones made from another surface).
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset when the palette opens
      setQuery(requestedQuery.current ?? '')
      requestedQuery.current = null
      setMru(getPaletteMru())
    }
  }, [open])

  // Preserve declaration order while promoting recent commands into one
  // non-duplicated section. A typed query restores the complete grouped list for
  // cmdk to filter.
  const { recentCommands, groups } = useMemo(
    () => buildCommandPaletteSections(commands, mru, query),
    [commands, mru, query],
  )

  const pick = (cmd: PaletteCommand) => {
    recordPaletteUse(cmd.id)
    onOpenChange(false)
    // Defer so a command that opens another dialog (e.g. Go to file) doesn't
    // race this palette's own close — two Radix dialogs toggling in one tick
    // fight over focus.
    setTimeout(
      () =>
        invokeUi(uiCommandUri(cmd), navigation, cmd.effect === 'write' ? { allowWrite: true } : {}),
      0,
    )
  }

  const renderRow = (cmd: PaletteCommand, keyPrefix: string) => (
    <CommandItem
      key={`${keyPrefix}${cmd.id}`}
      value={`${keyPrefix}${cmd.id}`}
      keywords={[cmd.label, ...(cmd.keywords ?? [])]}
      onSelect={() => pick(cmd)}
      className="gap-2"
    >
      <span className="truncate text-foreground">{cmd.label}</span>
      {cmd.chordId && (
        <ChordHint
          commandId={cmd.chordId}
          className="gap-1 pl-2"
          chipVariant="filled"
          chipClassName="text-3xs text-text-soft group-data-selected/command-item:text-sidebar-foreground"
        />
      )}
    </CommandItem>
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search and run a workspace command"
    >
      <Command>
        <CommandInput
          icon={SquareTerminal}
          placeholder="Run a command…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No matching command.</CommandEmpty>
          {recentCommands.length > 0 && (
            <CommandGroup heading="Recently used">
              {recentCommands.map((cmd) => renderRow(cmd, 'recent:'))}
            </CommandGroup>
          )}
          {groups.map(([group, list]) => (
            <CommandGroup key={group} heading={group}>
              {list.map((cmd) => renderRow(cmd, ''))}
            </CommandGroup>
          ))}
        </CommandList>
        <CommandHints active="commands" />
      </Command>
    </CommandDialog>
  )
}
