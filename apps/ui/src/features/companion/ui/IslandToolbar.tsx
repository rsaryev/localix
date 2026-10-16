import { useState } from 'react'
import { History, MessageSquare, Plus } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { Project, UiSession } from '@/shared/api/contracts'
import { IslandFolderPicker } from './IslandFolderPicker'
import type { useQuickChat } from '../model/useQuickChat'

export function IslandToolbar({
  chat,
  projects,
  sessions,
  onRefresh,
}: {
  chat: ReturnType<typeof useQuickChat>
  projects: readonly Project[]
  sessions: readonly UiSession[]
  onRefresh: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [menu, setMenu] = useState<'folder' | 'history' | null>(null)
  const active = projects.find((project) => project.id === chat.session?.projectId)
  const act = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(false)
    try {
      await action()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  const recent = sessions
    .filter((session) => !session.isArchived && !session.parentSessionId)
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 20)
  return (
    <>
      <div className="lx-island-toolbar flex min-w-0 items-center gap-1" aria-label="Chat actions">
        <IslandFolderPicker chat={chat} projects={projects} onRefresh={onRefresh} disabled={busy} />
        <div className="lx-island-toolbar-actions ml-auto flex items-center gap-1">
          <DropdownMenu
            open={menu === 'history'}
            onOpenChange={(open) => setMenu(open ? 'history' : null)}
          >
            <DropdownMenuTrigger asChild>
              <IconButton
                size="sm"
                tooltip="Session history"
                aria-label="Session history"
                disabled={busy}
              >
                <History />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              data-island-overlay
              align="end"
              className="max-h-52 w-64 overflow-y-auto"
            >
              <MenuEntries
                family="dropdown"
                entries={[
                  { header: 'Recent sessions' },
                  ...recent.map((session) => ({
                    id: session.id,
                    label: session.title || 'Untitled chat',
                    icon: MessageSquare,
                    selected: session.id === chat.sessionId,
                    onSelect: () => void act(() => chat.resume(session.id)),
                  })),
                  ...(recent.length
                    ? []
                    : [
                        {
                          id: 'empty',
                          label: 'No sessions yet',
                          disabled: true,
                          onSelect: () => {},
                        },
                      ]),
                ]}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton
            size="sm"
            tooltip="New session"
            aria-label="New session"
            disabled={busy || chat.running}
            onClick={() => void act(() => chat.startInProject(active?.id ?? null))}
          >
            <Plus />
          </IconButton>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-status-error">
          Could not open the conversation. Try again.
        </p>
      )}
    </>
  )
}
