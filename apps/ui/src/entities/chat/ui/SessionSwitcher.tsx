import { useEffect, useMemo } from 'react'
import { Check, Pin } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { sessionRef } from '@/shared/api/contracts'
import type { UiSession } from '@/shared/api/contracts'
import { PulsingDot } from '@localixai/kit/pulsing-dot'
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@localixai/kit/command'
import { CommandHints } from '@/shared/ui/command-hints'
import { useChatStore } from '../model/store'
import { subscribeUiOverlay } from '@/shared/lib/uiOverlayBus'
import { SESSION_SWITCHER_OVERLAY_ID } from './SessionSwitcher.surface'

interface SessionSwitcherProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeSessionId: string | null
  onSelect: (id: string) => void
}

/**
 * ⌘K / Ctrl+K session-switcher palette. Fuzzy-jump between chat sessions across
 * EVERY scope, grouped by workspace (one group per project). Picking a session
 * in another scope switches scope (the caller resolves the session's project).
 * Reuses the shared Command primitive, mirroring the ⌘P go-to-file palette.
 */
export function SessionSwitcher({
  open,
  onOpenChange,
  activeSessionId,
  onSelect,
}: SessionSwitcherProps) {
  useEffect(
    () => subscribeUiOverlay(SESSION_SWITCHER_OVERLAY_ID, () => onOpenChange(true)),
    [onOpenChange],
  )

  // The full roster (all scopes) so the switcher is a global jump target, not
  // just the current scope's loaded list.
  const { allSessions, projects } = useChatStore(
    useShallow((s) => ({ allSessions: s.allSessions, projects: s.projects })),
  )

  // Top-level chats only — sub-agents / jobs / threads aren't navigation
  // targets here. Group by scope: each project (in store order) that has chats.
  // Within a group, pinned-first then most-recent.
  const groups = useMemo(() => {
    const chats = allSessions.filter(
      (s) => s.sessionKind === 'chat' && !s.parentSessionId && !s.isArchived,
    )
    const sortIn = (list: UiSession[]) =>
      [...list].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt - a.updatedAt)
    const out: { key: string; label: string; sessions: UiSession[] }[] = []
    for (const p of projects) {
      const list = sortIn(chats.filter((s) => s.projectId === p.id))
      if (list.length) out.push({ key: p.id, label: p.name, sessions: list })
    }
    return out
  }, [allSessions, projects])

  const pick = (id: string) => {
    onSelect(id)
    onOpenChange(false)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Switch session"
      description="Jump to a chat session in any workspace"
    >
      <Command>
        <CommandInput placeholder="Switch session…" />
        <CommandList>
          <CommandEmpty>No sessions.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group.key} heading={group.label}>
              {group.sessions.map((s) => {
                const ref = s.seq ? sessionRef(s.seq) : ''
                const title = s.title?.trim() || ref || 'Untitled Chat'
                const active = s.id === activeSessionId
                return (
                  <CommandItem
                    key={s.id}
                    value={`${group.label} ${ref} ${title}`}
                    onSelect={() => pick(s.id)}
                    className="gap-2"
                  >
                    {s.isRunning ? (
                      <PulsingDot className="bg-status-success" />
                    ) : (
                      <span className="size-1.5 shrink-0 rounded-full bg-text-faint/40" />
                    )}
                    <span
                      className={`truncate ${active ? 'font-medium text-foreground' : 'text-text-soft'}`}
                    >
                      {title}
                    </span>
                    {s.isPinned && <Pin className="size-3 shrink-0 text-text-faint" />}
                    {active && <Check className="size-3 shrink-0 text-text-faint" />}
                    {ref && (
                      <span className="ml-auto shrink-0 font-mono text-2xs text-text-faint">
                        {ref}
                      </span>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))}
        </CommandList>
        <CommandHints active="sessions" />
      </Command>
    </CommandDialog>
  )
}
