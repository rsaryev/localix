import { useRef, useState } from 'react'
import { ChevronDown, Terminal } from 'lucide-react'
import { ComposerChip } from '@localixai/kit/composer-chip'
import { ActionTooltip } from '@localixai/kit/tooltip'
import { useChatStore } from '@/entities/chat/model/store'
import { findSessionInState } from '@/entities/chat/model/findSession'
import { externalAgentPresentation } from '@/shared/ui/externalAgentPresentation'
import { openOwnedExternalSession } from '../model/createSession'
import { useInstalledAgents } from '../model/useInstalledAgents'
import { externalAgentsApi } from '../api'
import { LocalixMark } from '@/shared/ui/LocalixMark'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { applyServerSession } from '@/entities/chat/model/sessionSync'

/** A chat can have a linked CLI; opening its pane never changes the chat or the draft. */
export function LinkedAgentTerminalPill({ sessionId }: { sessionId: string | null }) {
  const provider = useChatStore(
    (state) => findSessionInState(state, sessionId)?.externalAgentProvider,
  )
  const installed = useInstalledAgents()
  const [opening, setOpening] = useState(false)
  const inFlight = useRef(false)
  if (!sessionId) return null
  const { Icon, label } = externalAgentPresentation(provider ?? '')
  const open = async (selectedProvider?: string) => {
    if (inFlight.current) return
    inFlight.current = true
    setOpening(true)
    try {
      if (selectedProvider) {
        const linked = await externalAgentsApi.linkAgent(sessionId, selectedProvider)
        applyServerSession(linked)
      }
      await openOwnedExternalSession(sessionId)
    } catch (cause) {
      toast.error('Could not link this agent', {
        description: errorMessage(cause, '') || undefined,
      })
    } finally {
      inFlight.current = false
      setOpening(false)
    }
  }
  if (!provider) {
    const entries: MenuEntry[] = [
      { id: 'localix', label: 'Localix', icon: LocalixMark, selected: true, onSelect: () => {} },
      { separator: true },
      ...installed.agents.map((agent) => ({
        id: agent.id,
        label: agent.name,
        icon: externalAgentPresentation(agent.id).Icon,
        onSelect: () => void open(agent.id),
      })),
      ...(installed.agents.length
        ? []
        : [
            {
              id: 'unavailable',
              label: installed.isLoading
                ? 'Checking installed agents…'
                : installed.error
                  ? 'Could not check installed agents'
                  : 'No supported agent CLI is installed',
              disabled: true,
              onSelect: () => {},
            },
          ]),
    ]
    return (
      <DropdownMenu>
        <ActionTooltip label="Link a coding agent" side="top">
          <DropdownMenuTrigger asChild>
            <ComposerChip aria-label="Link a coding agent" aria-busy={opening} disabled={opening}>
              <LocalixMark className="size-3.5 shrink-0" />
              <span>Localix</span>
              <ChevronDown className="size-3.5 shrink-0 text-text-faint" aria-hidden="true" />
            </ComposerChip>
          </DropdownMenuTrigger>
        </ActionTooltip>
        <DropdownMenuContent align="start" side="top">
          <MenuEntries entries={entries} family="dropdown" />
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }
  const action = `Open ${label} terminal`
  return (
    <ActionTooltip label={action} side="top">
      <ComposerChip
        aria-label={action}
        aria-busy={opening}
        disabled={opening}
        onClick={() => void open()}
      >
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="max-w-32 truncate">{label}</span>
        <Terminal className="size-3.5 shrink-0 text-text-faint" aria-hidden="true" />
      </ComposerChip>
    </ActionTooltip>
  )
}
