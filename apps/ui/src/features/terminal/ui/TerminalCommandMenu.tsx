import { Copy, ClipboardList, ClipboardCopy, RotateCcw, Wrench, ExternalLink } from 'lucide-react'
import type { TerminalQuickFix } from '../model/terminalQuickFixes'
import {
  CoordinateMenu,
  CoordinateMenuItem,
  CoordinateMenuSeparator,
} from '@localixai/kit/coordinate-menu'

export interface CommandMenuState {
  x: number
  y: number
  command: string
  output: string
  /** Actionable fixes derived from the command's output (see terminalQuickFixes). */
  fixes: TerminalQuickFix[]
}

/**
 * Action menu for a finished command, opened by clicking its exit-code dot in the
 * gutter (shell integration). Copy the command, its output, both together, or
 * re-run it (pastes the command onto the prompt for review — never auto-executes).
 * The shared coordinate menu turns the xterm decoration's pointer coordinates
 * into a collision-aware Radix anchor and owns dismissal + keyboard navigation.
 */
export function TerminalCommandMenu({
  state,
  onCopyCommand,
  onCopyOutput,
  onCopyBoth,
  onRerun,
  onRunFix,
  onClose,
}: {
  state: CommandMenuState
  onCopyCommand: () => void
  onCopyOutput: () => void
  /** Copy the command line and its output together (command ⏎ output). */
  onCopyBoth: () => void
  onRerun: () => void
  /** Apply a quick fix: paste a `command` onto the prompt, or open a `link`. */
  onRunFix: (fix: TerminalQuickFix) => void
  onClose: () => void
}) {
  return (
    <CoordinateMenu
      x={state.x}
      y={state.y}
      label="Terminal command actions"
      onClose={onClose}
      className="min-w-[12rem] max-w-[min(24rem,calc(100vw-1rem))]"
    >
      {state.fixes.length > 0 && (
        <>
          {state.fixes.map((fix) => (
            <CoordinateMenuItem
              key={fix.label}
              title={fix.kind === 'command' ? fix.command : fix.url}
              onSelect={() => onRunFix(fix)}
            >
              {fix.kind === 'link' ? (
                <ExternalLink className="size-3.5 text-foreground" />
              ) : (
                <Wrench className="size-3.5 text-foreground" />
              )}
              <span className="truncate">{fix.label}</span>
            </CoordinateMenuItem>
          ))}
          <CoordinateMenuSeparator />
        </>
      )}
      <CoordinateMenuItem disabled={!state.command} onSelect={onCopyCommand}>
        <Copy className="size-3.5 text-text-soft" /> Copy command
      </CoordinateMenuItem>
      <CoordinateMenuItem disabled={!state.output} onSelect={onCopyOutput}>
        <ClipboardList className="size-3.5 text-text-soft" /> Copy output
      </CoordinateMenuItem>
      <CoordinateMenuItem disabled={!state.command && !state.output} onSelect={onCopyBoth}>
        <ClipboardCopy className="size-3.5 text-text-soft" /> Copy command + output
      </CoordinateMenuItem>
      <CoordinateMenuItem disabled={!state.command} onSelect={onRerun}>
        <RotateCcw className="size-3.5 text-text-soft" /> Rerun
      </CoordinateMenuItem>
    </CoordinateMenu>
  )
}
