/**
 * The conversation's mode — solo or group — as the first control of the participants strip,
 * beside the people it is about.
 *
 * An icon, the same size as Add participant beside it, not a pill: the strip is names and the two
 * small controls that change who is among them, and a labelled chip in front of them read as a
 * different kind of thing. One figure is solo, two are a group; the tooltip names the mode.
 * A pick in chrome is a menu, not a form (`docs/internals/visual-system.md`): the icon opens two
 * described rows. Solo is one agent, so with several seated its row says what to do instead of
 * offering a change the server would refuse.
 */
import { User, Users, type LucideIcon } from 'lucide-react'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { IconButton } from '@localixai/kit/icon-button'
import { MenuEntries } from '@localixai/kit/menu-entries'
import {
  CONVERSATION_MODE_COPY,
  CONVERSATION_MODES,
  type ConversationMode,
} from '@localixai/api/conversation-modes'

/** How a mode is DRAWN: one person or several. */
export const CONVERSATION_MODE_ICON: Record<ConversationMode, LucideIcon> = {
  solo: User,
  group: Users,
}

export function conversationModeEntries({
  value,
  onChange,
  canBeSolo,
}: {
  value: ConversationMode
  onChange: (next: ConversationMode) => void
  canBeSolo: boolean
}): MenuEntry[] {
  return CONVERSATION_MODES.map((mode): MenuEntry => {
    const copy = CONVERSATION_MODE_COPY[mode]
    const blocked = mode === 'solo' && value !== 'solo' && !canBeSolo
    return {
      id: mode,
      label: copy.label,
      description: blocked ? 'Remove the other participants first: solo is one agent.' : copy.hint,
      icon: CONVERSATION_MODE_ICON[mode],
      selected: mode === value,
      disabled: blocked,
      onSelect: () => {
        if (mode !== value && !blocked) onChange(mode)
      },
    }
  })
}

export function ConversationModeControl({
  value,
  onChange,
  canBeSolo,
  disabled,
}: {
  value: ConversationMode
  onChange: (next: ConversationMode) => void
  /** False while several agents are seated: solo holds one. */
  canBeSolo: boolean
  disabled?: boolean
}) {
  const Icon = CONVERSATION_MODE_ICON[value]
  const copy = CONVERSATION_MODE_COPY[value]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <IconButton
          size="xs"
          aria-label={`Conversation mode: ${copy.label}. Change`}
          tooltip={`${copy.label} conversation`}
        >
          <Icon className="size-3" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-72">
        <MenuEntries
          entries={conversationModeEntries({ value, onChange, canBeSolo })}
          family="dropdown"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
