import { useMemo } from 'react'
import type { ChatUsagePayload } from '@localixai/agent'
import { MonogramAvatar } from '@localixai/kit/avatar'
import { ProgressBar } from '@localixai/kit/progress-bar'
import { useAgentHandleIdentity } from '@/shared/contrib/useAgentIdentity'
import { createParticipantContextSelector } from '../../model/participantContextUsage'
import { findSessionInState } from '../../model/findSession'
import { useChatStore } from '../../model/store'
import { formatCost } from '../../model/usageFormat'

/**
 * One participant in the header's usage card: who, how full their context is, what they cost.
 * The roster chips used to carry a stats button each; the breakdown lives here instead, beside
 * the session total it adds up to.
 */
export function ParticipantUsageRow({
  sessionId,
  agentId,
  handle,
  usage,
}: {
  sessionId: string
  agentId: string
  handle: string
  usage?: ChatUsagePayload
}) {
  const identity = useAgentHandleIdentity(handle)
  const selectContext = useMemo(() => createParticipantContextSelector(agentId), [agentId])
  const view = useChatStore((state) =>
    selectContext(findSessionInState(state, sessionId)?.messages ?? []),
  )
  return (
    <li className="space-y-1">
      <div className="flex items-center gap-2 text-2xs">
        <MonogramAvatar identity={identity.handle} label={identity.name} size={16} />
        <span className="min-w-0 flex-1 truncate text-text-strong">{identity.name}</span>
        <span className="font-mono tabular-nums text-text-faint">{view.percentLabel}</span>
        <span className="w-14 text-right font-mono tabular-nums text-text-soft">
          {usage?.totalCost !== undefined ? formatCost(usage.totalCost) : '—'}
        </span>
      </div>
      <ProgressBar
        value={(view.fraction ?? 0) * 100}
        aria-label={`${identity.name} context usage`}
        className="h-1 bg-surface-active"
        fillClassName="bg-foreground/60"
      />
    </li>
  )
}
