/**
 * The terminal pane's transient surfaces: the link quickpick and the exit-code command menu.
 *
 * Two independent popovers, each open exactly when its own state is non-null. They share
 * nothing with the pane but two callbacks — refocus the terminal, write to the PTY — so
 * passing those and keeping the markup here leaves `TerminalPane` as the socket + xterm
 * lifecycle it is.
 */
import { copyText } from '@localixai/plugin-sdk/ui/interactions'

import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import type { TerminalLinkItem } from '../model/terminalLinks'
import type { TerminalQuickFix } from '../model/terminalQuickFixes'
import { TerminalCommandMenu, type CommandMenuState } from './TerminalCommandMenu'
import { TerminalLinkQuickpick } from './TerminalLinkQuickpick'
import { openTerminalLink } from '../model/terminalLinkOpen'

export interface TerminalPaneOverlaysProps {
  /** The chat the terminal belongs to — a picked file link opens in its editor grid. */
  sessionId: string
  linkPick: TerminalLinkItem[] | null
  setLinkPick: (value: TerminalLinkItem[] | null) => void
  cmdMenu: CommandMenuState | null
  setCmdMenu: (value: CommandMenuState | null) => void
  /** Radix returns focus to the trigger, not xterm's helper textarea — every close refocuses. */
  focusTerm: () => void
  write: (data: string) => void
}

export function TerminalPaneOverlays({
  sessionId,
  linkPick,
  setLinkPick,
  cmdMenu,
  setCmdMenu,
  focusTerm,
  write,
}: TerminalPaneOverlaysProps) {
  return (
    <>
      {linkPick !== null && (
        <TerminalLinkQuickpick
          items={linkPick}
          onSelect={(item) => {
            openTerminalLink(sessionId, item)
            setLinkPick(null)
          }}
          onClose={() => {
            setLinkPick(null)
            focusTerm()
          }}
        />
      )}
      {cmdMenu && (
        <TerminalCommandMenu
          state={cmdMenu}
          onCopyCommand={() => {
            if (cmdMenu.command) void copyText(cmdMenu.command, 'Command')
          }}
          onCopyOutput={() => {
            if (cmdMenu.output) void copyText(cmdMenu.output, 'Output')
          }}
          onCopyBoth={() => {
            const both = [cmdMenu.command, cmdMenu.output].filter(Boolean).join('\n')
            if (both) void copyText(both, 'Command and output')
          }}
          onRerun={() => {
            if (cmdMenu.command) write(cmdMenu.command)
          }}
          onRunFix={(fix: TerminalQuickFix) => {
            // A command fix is pasted onto the prompt for review (never auto-run,
            // matching Rerun); a link fix opens immediately.
            if (fix.kind === 'command') write(fix.command)
            else platformCapabilities().external.open(fix.url)
          }}
          onClose={() => {
            setCmdMenu(null)
            focusTerm()
          }}
        />
      )}
    </>
  )
}
