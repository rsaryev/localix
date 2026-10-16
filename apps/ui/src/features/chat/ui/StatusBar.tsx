import { Clock, PlugZap } from 'lucide-react'
import type { LspServerState, SessionTiming } from '@/shared/api/contracts'
import { useElapsedMs } from '@/shared/hooks/useCountdown'
import { formatElapsed as fmtMs } from '@localixai/plugin-sdk/ui/utilities'
import { useRealtimeConnection } from '@/shared/hooks/useRealtimeConnection'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { Popover, PopoverContent, PopoverTrigger } from '@localixai/kit/popover'
import {
  WorkbenchStatusBar,
  WorkbenchStatusButton,
  WorkbenchStatusItem,
} from '@localixai/kit/workbench-statusbar'

interface StatusBarProps {
  lspServers?: LspServerState[]
  sessionTiming?: SessionTiming | null
  /** True while the agent is actively running this session (drives the live ticker). */
  isRunning?: boolean
  /** Open the Problems panel — wired to the error/warning counts below. */
  onOpenProblems?: () => void
}

/** Ticks once per second; shows the persisted total plus elapsed time since mount. */
function LiveTotal({ baseMs }: { baseMs: number }) {
  const extraMs = useElapsedMs()
  return <span className="tabular-nums">{fmtMs(baseMs + extraMs)}</span>
}

function SessionTimingItem({ timing, isRunning }: { timing: SessionTiming; isRunning?: boolean }) {
  const rows: Array<{ label: string; value: number }> = [
    { label: 'Model (real)', value: timing.modelMs },
    { label: '· Wait / TTFT', value: timing.waitMs ?? 0 },
    { label: '· Tool-input gen', value: timing.toolGenMs ?? 0 },
    { label: 'Reveal (smoothing)', value: timing.revealMs ?? 0 },
    { label: 'Tools (exec)', value: timing.toolMs },
    { label: 'HITL wait', value: timing.hitlMs },
    { label: 'Idle / overhead', value: timing.idleMs },
  ]

  return (
    <Popover>
      <PopoverTrigger asChild>
        <WorkbenchStatusButton className="gap-1.5" title="Session timing">
          <Clock
            className={['size-2.5', isRunning ? 'text-status-success' : ''].join(' ')}
            aria-hidden="true"
          />
          <span className="font-semibold tracking-wide text-text-soft">
            {isRunning ? (
              <LiveTotal key="run" baseMs={timing.totalMs} />
            ) : (
              <span className="tabular-nums">{fmtMs(timing.totalMs)}</span>
            )}
          </span>
          <span className="text-text-faint">{isRunning ? 'running' : 'total'}</span>
        </WorkbenchStatusButton>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        aria-label="Session timing details"
        className="w-56 gap-0 overflow-hidden p-0"
      >
        <div className="flex flex-col divide-y divide-border-soft">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-medium text-text-strong">Total</span>
            <span className="text-xs font-semibold tabular-nums text-text-strong">
              {fmtMs(timing.totalMs)}
            </span>
          </div>
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between px-3 py-1.5">
              <span className="text-2xs text-text-soft">{r.label}</span>
              <span className="text-2xs tabular-nums text-text-faint">{fmtMs(r.value)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-3 py-1.5 text-2xs text-text-faint">
            <span>
              {timing.turns} {timing.turns === 1 ? 'turn' : 'turns'} · {timing.runs}{' '}
              {timing.runs === 1 ? 'run' : 'runs'}
            </span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function LspStatusItem({
  servers,
  onOpenProblems,
}: {
  servers: LspServerState[]
  onOpenProblems?: () => void
}) {
  const totalErrors = servers.reduce((s, v) => s + v.errorCount, 0)
  const totalWarnings = servers.reduce((s, v) => s + v.warningCount, 0)
  const hasServerError = servers.some((server) => server.status === 'error')
  const isStarting = servers.some((server) => server.status === 'starting')
  const tone =
    hasServerError || totalErrors > 0
      ? 'text-status-error'
      : totalWarnings > 0 || isStarting
        ? 'text-status-warning'
        : 'text-status-success'
  const title = [
    'LSP',
    hasServerError ? 'server error' : isStarting ? 'starting' : 'ready',
    totalErrors > 0 ? `${totalErrors} errors` : null,
    totalWarnings > 0 ? `${totalWarnings} warnings` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const className = cn('px-2 font-semibold uppercase tracking-widest', tone)

  return onOpenProblems ? (
    <WorkbenchStatusButton
      onClick={onOpenProblems}
      title={`${title}. Open Problems.`}
      aria-label={`${title}. Open Problems.`}
      className={className}
    >
      LSP
    </WorkbenchStatusButton>
  ) : (
    <WorkbenchStatusItem title={title} aria-label={title} className={className}>
      LSP
    </WorkbenchStatusItem>
  )
}

/**
 * Shown only while live events are NOT flowing — the bar's existing idiom, where
 * every segment appears on its own condition. Silence is the healthy state, so a
 * connected socket adds nothing to the chrome.
 */
function RealtimeStatusItem() {
  return (
    <WorkbenchStatusItem
      title="Lost the live connection to the local service — reconnecting. Views may be out of date until it returns."
      className="gap-1.5 px-2.5 text-status-warning"
    >
      <PlugZap className="size-3" aria-hidden="true" />
      <span>Reconnecting…</span>
    </WorkbenchStatusItem>
  )
}

export function StatusBar({
  lspServers,
  sessionTiming,
  isRunning,
  onOpenProblems,
}: StatusBarProps) {
  const hasLsp = Boolean(lspServers && lspServers.length > 0)
  const hasTiming = Boolean(sessionTiming && sessionTiming.totalMs > 0)
  const realtime = useRealtimeConnection()

  // Always reserve the bar's height — never unmount. When a run starts, timing/LSP
  // items fade in *inside* the fixed-height bar instead of growing the footer, so
  // the message viewport keeps a stable height and the layout never jolts.
  return (
    <WorkbenchStatusBar aria-label="Session status" divided>
      {realtime === 'reconnecting' && <RealtimeStatusItem />}
      {hasLsp && <LspStatusItem servers={lspServers!} onOpenProblems={onOpenProblems} />}
      {hasTiming && <SessionTimingItem timing={sessionTiming!} isRunning={isRunning} />}
    </WorkbenchStatusBar>
  )
}
