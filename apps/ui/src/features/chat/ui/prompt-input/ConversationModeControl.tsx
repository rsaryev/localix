/**
 * The conversation's mode — solo or group — as the first control of the participants strip,
 * beside the people it is about.
 *
 * A pick in chrome is a menu, not a form (`docs/internals/visual-system.md`): a quiet chip that
 * opens two described rows. Solo is one agent, so with several seated its row says what to do
 * instead of offering a change the server would refuse.
 */
import { ChevronDown, User, Users, type LucideIcon } from 'lucide-react'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { ComposerChip } from '@localixai/kit/composer-chip'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { ActionTooltip } from '@localixai/kit/tooltip'
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
      <ActionTooltip side="top" label={`${copy.label} conversation`}>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <ComposerChip
            aria-label={`Conversation mode: ${copy.label}. Change`}
            className="shrink-0 text-text-soft"
          >
            <Icon className="size-3.5" />
            <span>{copy.label}</span>
            <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden="true" />
          </ComposerChip>
        </DropdownMenuTrigger>
      </ActionTooltip>
      <DropdownMenuContent align="start" side="top" className="w-72">
        <MenuEntries
          entries={conversationModeEntries({ value, onChange, canBeSolo })}
          family="dropdown"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
