/**
 * THE PINNED MARK: this message stays in the agent's view when older turns are checkpointed.
 *
 * Shown only on a pinned message, like the reaction chips — a pin is rare, and a standing
 * control under every bubble would be furniture down the whole transcript. Pinning and unpinning
 * live in the message's context menu.
 */
import { Pin } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'

export function MessagePinnedMark({ align = 'start' }: { align?: 'start' | 'end' }) {
  return (
    <span
      className={cn(
        'flex items-center gap-1 text-2xs text-text-faint',
        align === 'end' ? 'self-end' : 'self-start',
      )}
      title="Kept whole in the agent's context, even after older turns are checkpointed"
    >
      <Pin className="size-3" aria-hidden />
      Pinned to agent context
    </span>
  )
}
