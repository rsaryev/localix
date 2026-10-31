/**
 * THE MARKS ON A MESSAGE — one chip per emoji, the people behind it in the tooltip.
 *
 * Reactions live in `payload.reactions` and are grouped into one chip per emoji.
 *
 * Grouped by emoji rather than listed per author, which is what every chat that has this does,
 * and for a reason worth stating: the useful fact is HOW MANY agreed, and the second useful fact
 * is whether YOU did. A list of authors answers neither at a glance.
 *
 * Renders NOTHING when there are no marks — no wrapper, no padding, no button. Adding one is the
 * context menu's job (see `MessageContextMenu`, and Telegram's own control, whose default state
 * is `Hidden`): a standing affordance under every bubble is a column of furniture down the whole
 * transcript, and the first version of this left an empty row under every message.
 */
import { useMemo } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

export interface MessageReaction {
  emoji: string
  /** `user`, or `agent:<id>` — the author ref exactly as the message stores it. */
  from: string
  at: string
}

const USER_REF = 'user'

/** Who is behind a mark, in words, for the chip's tooltip. */
function authorLabel(from: string): string {
  if (from === USER_REF) return 'you'
  return from.startsWith('agent:')
    ? `@${from.slice('agent:'.length).replace(/^builtin:/, '')}`
    : from
}

/** The emoji this viewer has already placed — what the context-menu strip shows as on. */
export function ownReactions(reactions?: readonly MessageReaction[]): string[] {
  return (reactions ?? []).filter((r) => r.from === USER_REF).map((r) => r.emoji)
}

export function MessageReactions({
  reactions,
  onToggle,
  align = 'start',
}: {
  reactions?: readonly MessageReaction[]
  onToggle: (emoji: string) => void
  align?: 'start' | 'end'
}) {
  // Grouped in first-appearance order: the row settles instead of reshuffling as counts change,
  // which is what makes a count readable at a glance.
  const groups = useMemo(() => {
    const byEmoji = new Map<string, MessageReaction[]>()
    for (const reaction of reactions ?? []) {
      const list = byEmoji.get(reaction.emoji)
      if (list) list.push(reaction)
      else byEmoji.set(reaction.emoji, [reaction])
    }
    return [...byEmoji.entries()]
  }, [reactions])

  if (groups.length === 0) return null

  return (
    <div className={cn('mt-1 flex flex-wrap items-center gap-1', align === 'end' && 'justify-end')}>
      {groups.map(([emoji, list]) => {
        const mine = list.some((r) => r.from === USER_REF)
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onToggle(emoji)}
            title={list.map((r) => authorLabel(r.from)).join(', ')}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs leading-none outline-none transition-colors focus-ring',
              // Your own mark is filled: the chip answers "did I react" before it answers "how
              // many", which is the order the eye asks in.
              mine
                ? 'bg-accent/15 text-foreground ring-1 ring-accent/40'
                : 'bg-surface-hover text-text-soft ring-1 ring-border-soft hover:text-foreground',
            )}
          >
            <span aria-hidden>{emoji}</span>
            {list.length > 1 && <span className="tabular-nums">{list.length}</span>}
          </button>
        )
      })}
    </div>
  )
}
