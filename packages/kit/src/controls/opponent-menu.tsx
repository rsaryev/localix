import { ChevronDown, MessageSquare, Zap, type LucideIcon } from 'lucide-react'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import { OPPONENTS, type Opponent } from '@localixai/plugin-sdk/opponent'
import { cn } from '@localixai/plugin-sdk/ui/classes'

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../overlays/dropdown-menu'
import { MenuEntries } from '../overlays/menu-entries'
import { Button } from './button'

/**
 * Who plays the other side of a game at this table: the chat agent, woken for each turn and
 * answering with the game's tool, or a decision model the game asks itself, which answers within a
 * few seconds without a word in the chat. A quiet trigger for a game's control row — the current
 * opponent's icon and name and a chevron, no border — so it reads as part of the row rather than as
 * a form field; the choice lives in its menu.
 */
export const OPPONENT_CHOICES = {
  agent: {
    label: 'Chat agent',
    icon: MessageSquare,
    description: 'The agent in this chat moves with its tool',
  },
  decision: {
    label: 'Decision model',
    icon: Zap,
    description: 'A decision model picks each move in a second',
  },
} as const satisfies Record<Opponent, { label: string; icon: LucideIcon; description: string }>

export interface OpponentMenuProps {
  value: Opponent
  onChange: (opponent: Opponent) => void
  disabled?: boolean
  /** The menu's heading, naming the side the opponent plays ("Who plays O"). */
  heading?: string
  /** The trigger's height on the control ladder: match the row it sits in. Default `lg`. */
  size?: 'sm' | 'default' | 'lg'
  className?: string
}

export function OpponentMenu({
  value,
  onChange,
  disabled,
  heading = 'Your opponent',
  size = 'lg',
  className,
}: OpponentMenuProps) {
  const current = OPPONENT_CHOICES[value]
  const entries: MenuEntry[] = [
    { header: heading },
    ...OPPONENTS.map((opponent) => ({
      id: opponent,
      ...OPPONENT_CHOICES[opponent],
      selected: opponent === value,
      onSelect: () => {
        if (opponent !== value) onChange(opponent)
      },
    })),
  ]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={size}
          aria-label={`Opponent: ${current.label}`}
          className={cn('text-text-soft', className)}
          disabled={disabled}
        >
          <current.icon data-icon="inline-start" />
          {current.label}
          <ChevronDown data-icon="inline-end" className="size-3.5 text-text-faint" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
