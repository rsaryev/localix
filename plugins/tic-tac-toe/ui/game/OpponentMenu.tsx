import { ChevronDown, MessageSquare, Zap } from 'lucide-react'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { Button } from '@localixai/kit/button'
import { MenuEntries } from '@localixai/kit/menu-entries'

import type { Opponent } from '../../shared/game'

/**
 * Who plays O at this table — a quiet trigger in the control row beside the new game: the current
 * opponent's icon and name, and a chevron that opens the choice. No border, so it reads as part of
 * the row rather than as a form field. The chat agent is woken for each move and answers with its
 * tool; the decision model is asked by the board itself and answers within a few seconds, without a
 * word in the chat. Either spends the person's model budget, recorded against this chat.
 */
const OPPONENTS = {
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
} as const satisfies Record<Opponent, { label: string; icon: unknown; description: string }>

export function OpponentMenu({
  value,
  disabled,
  onChange,
}: {
  value: Opponent
  disabled: boolean
  onChange: (opponent: Opponent) => void
}) {
  const current = OPPONENTS[value]
  const entries: MenuEntry[] = [
    { header: 'Who plays O' },
    ...(Object.keys(OPPONENTS) as Opponent[]).map((opponent) => ({
      id: opponent,
      ...OPPONENTS[opponent],
      checked: opponent === value,
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
          size="lg"
          aria-label={`Opponent: ${current.label}`}
          className="text-text-soft"
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
