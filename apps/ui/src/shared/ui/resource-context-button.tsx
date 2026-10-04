import { Link2 } from 'lucide-react'
import type { DragEvent, MouseEvent } from 'react'
import { resourceMessageBindingDraft } from '@localixai/plugin-sdk/ui'

import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'
import { composerBus } from '@/shared/lib/composerBus'
import { setMessageBindingDrag } from '@localixai/plugin-sdk/ui/message-binding-drag'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'

export interface ResourceContextTarget {
  uri: string
  label: string
}

/**
 * Native link/drag affordance shared by every resource-backed surface.
 *
 * A click links the resource into the composer of the chat this surface belongs to — `sessionId`,
 * else the surrounding transcript's or tab's session. Linking into the FOCUSED composer put a
 * resource shown in one chat's tab into another chat's next message. With no chat, a click does
 * nothing; dragging into an input still works, since the drop names its own composer.
 */
export function ResourceContextButton({
  uri,
  label,
  className,
  mode = 'icon',
  sessionId,
}: ResourceContextTarget & {
  className?: string
  mode?: 'icon' | 'action'
  /** The chat whose composer a click links into; defaults to the owning transcript or tab's. */
  sessionId?: string | null
}) {
  const ownerSessionId = useWorkItemSessionId()
  const target = sessionId === undefined ? ownerSessionId : sessionId
  const link = (event: MouseEvent) => {
    event.stopPropagation()
    if (!target) return
    composerBus.insert({
      sessionId: target,
      bindings: [resourceMessageBindingDraft({ uri, label })],
    })
  }
  const drag = (event: DragEvent) => {
    event.stopPropagation()
    const binding = resourceMessageBindingDraft({ uri, label }, 'drag')
    setMessageBindingDrag(event.dataTransfer, binding)
    event.dataTransfer.setData('text/plain', binding.target.token)
    event.dataTransfer.effectAllowed = 'copy'
  }
  const common = {
    'aria-label': `Link ${label} to chat`,
    title: 'Link to the composer · or drag into the input',
    draggable: true,
    className: cn('cursor-grab active:cursor-grabbing', className),
    onClick: link,
    onDragStart: drag,
  }

  if (mode === 'action') {
    return (
      <Button variant="outline" size="sm" {...common}>
        <Link2 className="size-3" />
        <span className="@max-sm:sr-only">Link</span>
      </Button>
    )
  }
  // The two modes are interchangeable in a toolbar, so they must be the same
  // measure: `size="sm"` here is the SAME 24px as the Button above. It used to
  // render 20px against that Button's 24px — the same prop word meaning two
  // sizes — which is the defect that re-tiered IconButton onto Button's ladder.
  return (
    <IconButton size="sm" tooltip="Link to composer · or drag into the input" {...common}>
      <Link2 className="size-3" />
    </IconButton>
  )
}
