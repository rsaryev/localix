import { Pin } from 'lucide-react'
import { externalAgentPresentation } from '@/shared/ui/externalAgentPresentation'
import { LocalixMark } from '@/shared/ui/LocalixMark'
import type { ReactNode } from 'react'
import type { UiSession } from '@/shared/api/contracts'
import { StatusDot } from '@localixai/kit/status-dot'
import { formatRelativeTime } from '@localixai/plugin-sdk/ui/utilities'

import { attentionBySession } from '../model/attention/select'
import { useAttentionStore } from '../model/attention/store'
import { ATTENTION_PRESENTATION } from './attention/presentation'

/** Root and nested rows use the same geometry token. */
export const SESSION_ROW_HEIGHT_CLASS = 'h-[var(--session-row-height)]'

/**
 * One status slot, in order of what the person should do about it: the conversation's most
 * pressing attention item (a blocked request, a plan, a mention, a queued question — ranked by
 * the shared policy, drawn by the shared presentation), then unread, then pinned. The row reads
 * the same roster as the dialog and the dock, so it cannot show a different "waiting" than they do.
 */
export function RowBadge({ session }: { session: UiSession }) {
  const waiting = useAttentionStore((state) => attentionBySession(state.items).get(session.id))
  const top = waiting?.[0]
  if (top) {
    const { icon: Icon, toneClass, label } = ATTENTION_PRESENTATION[top.kind].badge
    const text = label(waiting)
    return (
      <span title={text} aria-label={text} className={`flex ${toneClass}`}>
        <Icon className="size-3" aria-hidden="true" />
      </span>
    )
  }
  if (session.isUnread) {
    return <StatusDot size="md" label="Unread conversation" className="bg-status-info" />
  }
  if (session.isPinned) return <Pin className="size-3 text-sidebar-foreground/50" />
  return null
}

/** One line for the conversation name; the latest message belongs in the chat itself. */
export function SessionRowContent({
  session,
  title,
  isActive,
}: {
  session: UiSession
  title: string
  isActive: boolean
}) {
  const provider = session.externalAgentProvider
  const { Icon: AgentIcon, label: agentLabel } = externalAgentPresentation(provider ?? '')
  const label = provider ? agentLabel : 'Localix'
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="flex shrink-0 text-text-soft" role="img" aria-label={label} title={label}>
        {provider ? (
          <AgentIcon className="size-3.5" aria-hidden="true" />
        ) : (
          <LocalixMark className="size-3.5" />
        )}
      </span>
      <span
        className={[
          'min-w-0 flex-1 truncate text-sm leading-5 transition-colors',
          isActive
            ? 'text-sidebar-foreground'
            : 'text-sidebar-foreground/85 group-hover:text-sidebar-foreground',
        ].join(' ')}
        title={title}
      >
        {title}
      </span>
    </div>
  )
}

/** The same time and status column for root conversations and nested sessions. */
export function SessionRowTimestamp({ session }: { session: UiSession }) {
  return (
    <span
      className="text-2xs tabular-nums text-sidebar-foreground/45"
      title={`Updated ${new Date(session.updatedAt).toLocaleString()}`}
    >
      {formatRelativeTime(session.updatedAt)}
    </span>
  )
}

export function SessionRowMeta({ session, actions }: { session: UiSession; actions?: ReactNode }) {
  return (
    <div className="ml-2 flex shrink-0 items-center justify-end gap-2 select-none">
      {actions ?? <SessionRowTimestamp session={session} />}
      <span className="flex w-3 shrink-0 items-center justify-center">
        <RowBadge session={session} />
      </span>
    </div>
  )
}
