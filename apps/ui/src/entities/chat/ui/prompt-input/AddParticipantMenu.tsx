/**
 * Adding someone to a conversation that already exists.
 *
 * Every chat starts normally; this menu is the one place a person turns it into a group.
 * Already seated or unavailable agents are omitted instead of shown as dead choices.
 *
 * Described rows (`MenuEntries`), not hand-built items: the rows used to place an 18px monogram
 * beside the label themselves, so the same agent was a different size here than in the plan's
 * Agent submenu, and the spacing was this file's own. `monogramIcon` is the one agent glyph.
 */
import { UserPlus } from 'lucide-react'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import { IconButton } from '@localixai/kit/icon-button'
import { monogramIcon } from '@localixai/kit/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { useAgents } from '@/shared/contrib/useAgents'
import { canJoinConversation } from '@localixai/api/agent-policy'

export interface AddParticipantMenuProps {
  /** Who is already here — excluded from the list. */
  seatedAgentIds: readonly string[]
  /** Scope the roster is read in ('' is global). */
  projectId: string
  onAdd: (agentId: string) => void
}

export function AddParticipantMenu({ seatedAgentIds, projectId, onAdd }: AddParticipantMenuProps) {
  const { agents } = useAgents(projectId)
  const entries: MenuEntry[] = agents
    .filter((agent) => canJoinConversation(agent) && !seatedAgentIds.includes(agent.record.id))
    .map((agent) => {
      const label = agent.record.label || agent.record.handle
      return {
        id: agent.record.id,
        label,
        icon: monogramIcon(agent.record.handle, label),
        onSelect: () => onAdd(agent.record.id),
      }
    })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="xs" aria-label="Add participant" tooltip="Add participant">
          <UserPlus className="size-3" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        <MenuEntries
          entries={
            entries.length > 0
              ? entries
              : [
                  // An answer, not a command: disabled, so it cannot be chosen.
                  {
                    id: 'none',
                    label: 'Everyone available is already here',
                    disabled: true,
                    onSelect: () => {},
                  },
                ]
          }
          family="dropdown"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
