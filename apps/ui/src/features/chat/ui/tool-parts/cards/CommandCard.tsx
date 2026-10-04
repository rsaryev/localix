import { useCallback, useState } from 'react'
import { SquareTerminal, Copy, Check } from 'lucide-react'
import type { CommandItem } from '@localixai/agent/agents'
import { terminal as terminalBus } from '@/shared/lib/terminalBus'
import { useIsTerminalLive } from '@/features/terminal/model/liveTerminals'
import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'
import { ToolLine } from '../ToolLine'
import { ErrorRow, IORow, OutputBlock, ToolBody, ToolHeaderAction } from '../ToolIO'
import {
  isItemStreaming,
  hasItemError,
  isItemDeclined,
  itemErrorHeadline,
  itemErrorMessage,
  statusLabel,
} from '../itemHelpers'
import { toolMeta } from './meta'
import { strField } from './format'
import { formatDuration } from '@localixai/plugin-sdk/ui/utilities'
import { formatCommand } from './commandFormat'
import { ConsoleOutput } from '../ConsoleOutput'
import { useCopied } from '@localixai/plugin-sdk/ui/interactions'
import { CodePreview } from '@/shared/ui/code-block/CodePreview'
import { clampConsoleHead, consoleLastLine } from '../consoleTail'
import { StatusDot } from '@localixai/kit/status-dot'
import { STATUS_TONE_DOT } from '@localixai/kit/status-dot'
import { MetadataTooltip } from '@localixai/kit/tooltip'

// Keep grammar tokenization out of the pathological-command path. The complete
// command remains copyable/runnable from the header actions; only its inline
// syntax projection falls back to plain text above this budget.
const MAX_HIGHLIGHTED_COMMAND_CHARS = 200_000

export function ExitBadge({ code }: { code: number }) {
  const label = `Process exited with code ${code} (non-zero = failure)`
  return (
    <MetadataTooltip label={label}>
      <span className="inline-flex items-center gap-1 font-mono text-2xs font-semibold tabular-nums text-status-error">
        <StatusDot className={STATUS_TONE_DOT.error} />
        <span aria-hidden="true">exit {code}</span>
        <span className="sr-only">{label}</span>
      </span>
    </MetadataTooltip>
  )
}

export function BgBadge({ status }: { status: CommandItem['jobStatus'] }) {
  const done = status !== undefined && status !== 'running'
  const tone = !done ? 'running' : status === 'completed' ? 'done' : 'error'
  const label = `Background job${status ? ` — ${status}` : ''}`
  return (
    <MetadataTooltip label={label}>
      <span className="inline-flex items-center gap-1 text-2xs font-medium text-text-soft">
        <StatusDot className={STATUS_TONE_DOT[tone]} />
        <span aria-hidden="true">BG</span>
        <span className="sr-only">{label}</span>
      </span>
    </MetadataTooltip>
  )
}

export function CommandCard({ item }: { item: CommandItem }) {
  // The chat whose transcript holds this card ran the command, so its job pane and a re-run both
  // belong to that chat's terminal. Read off the chat on screen, a card in a background pane
  // opened its job in — and pasted its command into — another chat's shell.
  const sessionId = useWorkItemSessionId()
  const [killedLocally, setKilledLocally] = useState(false)
  const { copied, copy } = useCopied()

  // Background job → open it as an interactive terminal pane. Jobs are PTY-backed
  // whenever a terminal host is wired (the normal app), so clicking always reveals
  // the terminal. The rare headless fallback (no terminalId) simply expands the
  // card's inline output instead — no modal, no sub-session.
  const inTerminal = Boolean(item.isBackground && item.terminalId)
  // A running job's PTY is live; once it's gone from the registry the pane can't
  // reconnect, so the action disables instead of opening a dead pane on scroll.
  // (Reload-safe auto-reveal of live jobs lives in useTerminalBusWiring.)
  const liveTerminal = useIsTerminalLive(item.terminalId) || item.jobStatus === 'running'
  const canOpen = inTerminal && liveTerminal
  const openInTerminal = useCallback(() => {
    if (item.terminalId && sessionId) {
      terminalBus.openJob({
        terminalId: item.terminalId,
        sessionId,
        title: item.command || 'Task',
      })
    }
  }, [item.terminalId, item.command, sessionId])

  const description = strField(item.input, 'description')
  const rawCommand = item.command || strField(item.input, 'command') || ''
  const commandPreview = clampConsoleHead(rawCommand)

  // description → human label (no $); otherwise format the raw command with $ prefix
  const title = description ?? (rawCommand ? `$ ${formatCommand(rawCommand)}` : item.name)

  const serverKilled = item.jobStatus === 'killed' || item.jobStatus === 'timeout'
  // Foreground: active while the tool call itself streams.
  // Background: the call completes immediately; the job's own status keeps it live.
  const isForegroundActive = !item.isBackground && isItemStreaming(item)
  const isBackgroundActive = Boolean(item.isBackground && item.jobStatus === 'running')
  const isActive = !killedLocally && !serverKilled && (isForegroundActive || isBackgroundActive)

  const errorMessage = itemErrorMessage(item)
  const hasError = hasItemError(item)

  const subtitle =
    killedLocally && (isForegroundActive || isBackgroundActive)
      ? 'killing…'
      : isActive
        ? item.isBackground
          ? 'Running in background…'
          : (consoleLastLine(item.output ?? '') ?? 'Running…')
        : item.durationMs !== undefined
          ? formatDuration(item.durationMs)
          : hasError || isItemDeclined(item)
            ? (itemErrorHeadline(item) ?? statusLabel(item.status) ?? 'Failed')
            : statusLabel(item.status) || 'Done'

  const badge = (
    <span className="flex items-center gap-1">
      {item.isBackground && (
        <BgBadge status={item.jobStatus ?? (isActive ? 'running' : 'completed')} />
      )}
      {item.exitCode !== undefined && item.exitCode !== 0 && <ExitBadge code={item.exitCode} />}
    </span>
  )

  // Live background jobs open as a terminal pane; everything else falls back to
  // the ToolLine's own inline expand toggle (handleClick left undefined).
  const handleClick = canOpen ? openInTerminal : undefined

  const headerActions = inTerminal ? (
    canOpen ? (
      <ToolHeaderAction icon={SquareTerminal} label="Terminal" onClick={openInTerminal} />
    ) : (
      <ToolHeaderAction icon={SquareTerminal} label="Terminal closed" onClick={() => {}} disabled />
    )
  ) : rawCommand && !isActive ? (
    <>
      {/* Copy the agent's exact command (mobile, paste elsewhere). */}
      <ToolHeaderAction
        icon={copied ? Check : Copy}
        label={copied ? 'Copied' : 'Copy'}
        onClick={() => void copy(rawCommand)}
      />
      {/* Re-run the agent's command yourself: paste it onto the terminal prompt. */}
      <ToolHeaderAction
        icon={SquareTerminal}
        label="Run"
        disabled={!sessionId}
        onClick={() => {
          if (sessionId) terminalBus.run({ sessionId, command: rawCommand })
        }}
      />
    </>
  ) : undefined

  return (
    <ToolLine
      icon={toolMeta('bash').icon}
      title={title}
      titleDetails={rawCommand || title}
      subtitle={subtitle}
      badge={badge}
      headerActions={headerActions}
      onRegisteredActionStart={(action) => {
        if (action.action === 'kill') setKilledLocally(true)
      }}
      isLoading={isActive}
      hasError={hasError && item.exitCode !== 0}
      isDismissed={isItemDeclined(item)}
      durationMs={item.durationMs}
      // Opens only on failure, so the error stays visible. It used to open while the command
      // ran and fold when it finished: a run of commands opened and shut a console of up to
      // 16rem once per call, and the transcript jumped with each. The live output rides the
      // subtitle instead (the last line printed); the full console is one click away.
      autoOpen={hasError}
      onClick={handleClick}
    >
      <ToolBody>
        {rawCommand && (
          <IORow label="IN">
            <CodePreview
              code={commandPreview}
              syntaxHighlight={rawCommand.length <= MAX_HIGHLIGHTED_COMMAND_CHARS}
              className="text-text-faint"
            />
          </IORow>
        )}
        {isActive ? (
          <IORow label="OUT">
            <ConsoleOutput output={item.output ?? ''} isStreaming={isActive} className="max-h-64" />
          </IORow>
        ) : (
          <IORow label="OUT">
            {item.output ? (
              <OutputBlock linkify>{item.output}</OutputBlock>
            ) : (
              <span className="text-2xs text-text-faint">No output</span>
            )}
          </IORow>
        )}
        <ErrorRow message={errorMessage} />
      </ToolBody>
    </ToolLine>
  )
}
