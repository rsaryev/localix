// Pure presentation helpers (title / status text / kind styling) for the
// runtime sessions panel, extracted from RuntimeSessionsPanel.
import { Bot, Cpu } from 'lucide-react'

import type { UiSession } from '@/shared/api/contracts'
import type { SessionActivity } from '@localixai/plugin-sdk/ui/session-activity'
import type { WorkStatusTone } from '@localixai/kit/status-dot'

export function titleFor(session: UiSession): string {
  return session.title?.trim() || (session.sessionKind === 'job' ? 'Job' : 'Subagent')
}

/** Standardized status tone for the leading dot (shared with jobs + tasks). */
export function sessionTone(session: UiSession): WorkStatusTone {
  switch (session.runtimeStatus) {
    case 'running':
      return 'running'
    case 'completed':
      return 'done'
    case 'failed':
      return 'error'
    case 'stopped':
    case 'idle':
      return 'idle'
  }
  return 'idle'
}

export function statusText(session: UiSession): string {
  if (session.runtimeStatus === 'running') return session.sessionKind === 'job' ? 'job' : 'subagent'
  if (session.runtimeStatus === 'completed') return 'done'
  if (session.runtimeStatus === 'failed') return 'failed'
  if (session.runtimeStatus === 'stopped') return 'stopped'
  return session.sessionKind === 'job' ? 'job' : 'subagent'
}

// Compact "N turns · M tools" label for a live child run (sub-agent or delegated task run). Reads the
// external tick store's snapshot, not the session: these counts are not roster state (see
// model/sessionActivityStore.ts). Same phrasing as the delegate card so the two surfaces read
// alike. Returns undefined when no counts are known.
export function runtimeCountsLabel({ turnCount, toolCount }: SessionActivity): string | undefined {
  const parts: string[] = []
  if (typeof turnCount === 'number' && turnCount > 0)
    parts.push(`${turnCount} ${turnCount === 1 ? 'turn' : 'turns'}`)
  if (typeof toolCount === 'number' && toolCount > 0)
    parts.push(`${toolCount} ${toolCount === 1 ? 'tool' : 'tools'}`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

export function kindStyle(session: UiSession): {
  icon: typeof Bot
  iconWrap: string
  label: string
} {
  if (session.sessionKind === 'job') {
    return {
      icon: Cpu,
      iconWrap: 'bg-surface-active text-text-faint ring-control-border/65',
      label: 'job',
    }
  }
  return {
    icon: Bot,
    iconWrap: 'bg-surface-active text-text-faint ring-control-border/65',
    label: 'subagent',
  }
}
