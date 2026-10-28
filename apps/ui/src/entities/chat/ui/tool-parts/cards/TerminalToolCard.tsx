import { SquareTerminal } from 'lucide-react'
import type { ToolCallItem } from '@localixai/agent/agents'
import { terminal as terminalBus } from '@/shared/lib/terminalBus'
import { useIsTerminalLive } from '@/shared/lib/terminals/liveTerminals'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { ToolLine } from '../ToolLine'
import { ErrorRow, IORow, OutputBlock, ToolBody, ToolHeaderAction } from '../ToolIO'
import { isItemStreaming, hasItemError, statusLabel, itemErrorMessage } from '../itemHelpers'
import { toolMeta } from './meta'
import { asRecord, strField } from './format'

interface ScreenView {
  text: string
  cursor?: { row: number; col: number }
  cols?: number
  rows?: number
}

export function terminalActionTitle(
  action: string,
  command: string | undefined,
  keys: readonly string[],
): string {
  if (action === 'open' && command) return `$ ${command}`
  if (action === 'keys' && keys.length) return `Keys: ${keys.join(' ')}`
  if (action === 'type') return 'Type input'
  if (action === 'close') return 'Close terminal'
  if (action === 'list') return 'List terminals'
  return 'Terminal'
}

/** Pull the rendered-screen snapshot out of the tool details (item.output). */
function readScreen(output: unknown): ScreenView | undefined {
  const screen = asRecord(asRecord(output)?.screen)
  if (!screen || typeof screen.text !== 'string') return undefined
  const cursor = asRecord(screen.cursor)
  return {
    text: screen.text,
    cursor:
      cursor && typeof cursor.row === 'number' && typeof cursor.col === 'number'
        ? { row: cursor.row, col: cursor.col }
        : undefined,
    cols: typeof screen.cols === 'number' ? screen.cols : undefined,
    rows: typeof screen.rows === 'number' ? screen.rows : undefined,
  }
}

/**
 * Card for the interactive `terminal` tool. It renders the agent's view — the
 * VT-emulated screen grid — inline, and (like a background bash job) reveals the
 * LIVE PTY pane so the user watches the agent drive in real time. The pane is
 * attached to the same backend terminal, so the keystrokes the agent sends paint
 * there instantly; this card is the transcript-side echo.
 */
export function TerminalToolCard({ item }: { item: ToolCallItem }) {
  // The chat whose transcript holds this card drove the terminal, so the pane opens in ITS
  // workspace — not in whichever chat is on screen while the card sits in a background pane.
  const sessionId = useWorkItemSessionId()

  const input = asRecord(item.input)
  const output = asRecord(item.output)
  const action = strField(input, 'action') ?? strField(output, 'action') ?? 'terminal'
  const command = strField(output, 'command') ?? strField(input, 'command')
  const terminalId = strField(output, 'terminalId') ?? strField(input, 'terminal_id')
  const keys = Array.isArray(input?.keys)
    ? (input!.keys as unknown[]).filter((k): k is string => typeof k === 'string')
    : []
  const screen = readScreen(item.output)

  const streaming = isItemStreaming(item)
  const hasError = hasItemError(item)

  // Is the backend PTY still alive? While the call streams it's effectively live
  // even before the registry poll catches it. A finished/closed terminal isn't,
  // so the action below disables instead of resurrecting a dead pane on scroll.
  const live = useIsTerminalLive(terminalId) || streaming

  // Reveal the live terminal pane (same mechanism as background bash jobs).
  // The reload-safe auto-restore lives in useTerminalBusWiring, driven by the
  // live-PTY registry — NOT this card's mount (the transcript is virtualized).
  // Plain handler — the React Compiler (enabled in the Vite build) memoizes it
  // automatically. A manual useCallback here "could not be preserved" by the
  // compiler, which made it bail out of optimizing the whole card.
  const openInTerminal = () => {
    if (terminalId && sessionId) {
      const title = command || 'Terminal'
      terminalBus.openJob({ terminalId, sessionId, title })
    }
  }

  const title = terminalActionTitle(action, command, keys)

  const subtitle = streaming
    ? 'Working…'
    : hasError
      ? 'Failed'
      : screen?.cursor
        ? `${screen.cols ?? '?'}×${screen.rows ?? '?'} · cursor ${screen.cursor.row}:${screen.cursor.col}`
        : statusLabel(item.status)

  const errorMsg = itemErrorMessage(item)

  return (
    <ToolLine
      icon={toolMeta('terminal').icon}
      title={title}
      titleDetails={command || title}
      subtitle={subtitle}
      isLoading={streaming}
      hasError={hasError}
      // Opens only on failure, so the error remains visible. Opening while the agent drove the
      // terminal and folding when the call ended moved a 288px screen grid in and out of the
      // transcript once per call; the live PTY pane stays one click away (header action).
      autoOpen={hasError}
      headerActions={
        terminalId ? (
          live ? (
            <ToolHeaderAction icon={SquareTerminal} label="Terminal" onClick={openInTerminal} />
          ) : (
            <ToolHeaderAction
              icon={SquareTerminal}
              label="Terminal closed"
              onClick={() => {}}
              disabled
            />
          )
        ) : undefined
      }
    >
      <ToolBody>
        {screen && (
          <IORow label="Out">
            {/* `overscroll-contain`: nested inside the transcript scroller — hitting
                the end of the captured screen must not scroll the conversation. */}
            <pre className="scrollbar-thin max-h-72 overflow-auto overscroll-contain px-1 py-1.5 font-mono text-2xs leading-[1.4] text-text-soft whitespace-pre">
              {screen.text || '(blank screen)'}
            </pre>
          </IORow>
        )}
        {!screen && item.resultText && (
          <IORow label="Out">
            <OutputBlock>{item.resultText}</OutputBlock>
          </IORow>
        )}
        <ErrorRow message={errorMsg} linkify={false} />
      </ToolBody>
    </ToolLine>
  )
}
