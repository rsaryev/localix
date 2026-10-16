import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { MonogramAvatar, monogramInkStyle } from '@localixai/kit/avatar'

export interface TabSpec {
  icon: LucideIcon
  label: string
  active?: boolean
  className?: string
}

/**
 * A Localix pane as the scenes draw it: a tab strip and a body. In a card the window rises from
 * the bottom edge (and, in a wide card, the right edge), the way a pane sits in the workspace.
 */
export function Window({
  tabs,
  className,
  children,
}: {
  tabs: TabSpec[]
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`k-window ${className ?? ''}`}>
      <div className="k-tabs">
        {tabs.map(({ icon: Icon, label, active, className: tabClass }) => (
          <span key={label} className={`k-tab ${tabClass ?? ''}`} data-active={active || undefined}>
            <Icon className="size-3" />
            {label}
            <X className="k-tab-x size-2.5" />
          </span>
        ))}
      </div>
      <div className="k-body">{children}</div>
    </div>
  )
}

/** A message's author line: avatar, name in the avatar's ink, time. */
export function AgentHeader({ id, name }: { id: string; name: string }) {
  return (
    <span className="k-author">
      <MonogramAvatar identity={id} label={name} size={18} />
      <b style={monogramInkStyle(id)}>{name}</b>
      <time>11:35</time>
    </span>
  )
}

/** An @mention as the transcript draws it: a small avatar and the handle in a pill. */
export function Mention({ id, name }: { id: string; name: string }) {
  return (
    <span className="k-mention">
      <MonogramAvatar identity={id} label={name} size={12} />@{id}
    </span>
  )
}
