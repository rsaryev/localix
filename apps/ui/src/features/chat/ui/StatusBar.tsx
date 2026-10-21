import { PlugZap } from 'lucide-react'
import type { LspServerState } from '@/shared/api/contracts'
import { useRealtimeConnection } from '@/shared/hooks/useRealtimeConnection'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import {
  WorkbenchStatusBar,
  WorkbenchStatusButton,
  WorkbenchStatusItem,
} from '@localixai/kit/workbench-statusbar'
import type { ReactNode } from 'react'

interface StatusBarProps {
  lspServers?: LspServerState[]
  /** Open the Problems panel — wired to the error/warning counts below. */
  onOpenProblems?: () => void
  /** App-wide background work the page composes in (the semantic index), at the trailing edge. */
  trailing?: ReactNode
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

export function StatusBar({ lspServers, onOpenProblems, trailing }: StatusBarProps) {
  const hasLsp = Boolean(lspServers && lspServers.length > 0)
  const realtime = useRealtimeConnection()

  // Always reserve the bar's height — never unmount. When a run starts, LSP
  // items fade in *inside* the fixed-height bar instead of growing the footer, so
  // the message viewport keeps a stable height and the layout never jolts.
  return (
    <WorkbenchStatusBar aria-label="Session status" divided>
      {realtime === 'reconnecting' && <RealtimeStatusItem />}
      {hasLsp && <LspStatusItem servers={lspServers!} onOpenProblems={onOpenProblems} />}
      {/* App-wide background work sits at the trailing edge, as in an editor's status bar. */}
      {trailing}
    </WorkbenchStatusBar>
  )
}
