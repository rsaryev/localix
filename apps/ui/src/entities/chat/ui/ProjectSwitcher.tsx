import { useEffect, useMemo } from 'react'
import { Check, Folder, FolderPlus } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
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
import { getProjectMru, orderByMru } from '@/shared/lib/projectMru'
import { useRoutedNavigation } from '@/shared/hooks/useRoutedNavigation'
import { useChatStore } from '../model/store'
import { useAddProjectFolder } from '../model/useAddProjectFolder'
import { subscribeUiOverlay } from '@/shared/lib/uiOverlayBus'
import { PROJECT_SWITCHER_OVERLAY_ID } from './ProjectSwitcher.surface'

interface ProjectSwitcherProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * ⌘/Ctrl+⌥+P project quick-switcher (an "open recent" list). Fuzzy-jump
 * between opened project folders, ordered most-recently-used first, with the
 * active one checked. Reuses the shared Command primitive — the keyboard-first
 * sibling of the composer's project chip. Picking a project switches the active
 * workspace scope; an "Add folder…" row mirrors the chip so the switcher is a
 * complete keyboard entry point (no need to reach for the mouse).
 */
export function ProjectSwitcher({ open, onOpenChange }: ProjectSwitcherProps) {
  useEffect(
    () => subscribeUiOverlay(PROJECT_SWITCHER_OVERLAY_ID, () => onOpenChange(true)),
    [onOpenChange],
  )

  const { projects, activeProjectId } = useChatStore(
    useShallow((s) => ({
      projects: s.projects,
      activeProjectId: s.activeProjectId,
    })),
  )
  const nav = useRoutedNavigation()
  const addFolder = useAddProjectFolder()

  // MRU-ordered project list (recent first, then the rest in store order). Read
  // once per open so a switch made while the dialog is closed is reflected next
  // time it opens, without churning on every keystroke.
  const ordered = useMemo(() => {
    if (!open) return projects
    const byId = new Map(projects.map((p) => [p.id, p] as const))
    return orderByMru(
      projects.map((p) => p.id),
      getProjectMru(),
    )
      .map((id) => byId.get(id))
      .filter((p): p is (typeof projects)[number] => p != null)
    // `open` is intentionally a dependency: re-read the MRU each time the dialog opens.
  }, [projects, open])

  const pick = (id: string) => {
    onOpenChange(false)
    // Scope changes go through the URL (single source of truth). switchProject
    // drops the session so it resolves to the scope's default; the URL→store sync
    // then updates activeProjectId.
    if (id !== activeProjectId) nav.switchProject(id)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Switch workspace"
      description="Jump between your project folders"
    >
      <Command>
        <CommandInput placeholder="Switch workspace…" />
        <CommandList>
          <CommandEmpty>No workspaces.</CommandEmpty>
          <CommandGroup heading="Actions">
            <CommandItem
              value="add folder open new project"
              onSelect={() => {
                onOpenChange(false)
                void addFolder()
              }}
              className="gap-2"
            >
              <FolderPlus className="size-3.5 shrink-0 opacity-70" />
              <span className="text-text-soft">Add folder…</span>
            </CommandItem>
          </CommandGroup>
          {ordered.length > 0 && (
            <CommandGroup heading="Projects">
              {ordered.map((p) => {
                const active = p.id === activeProjectId
                return (
                  <CommandItem
                    key={p.id}
                    value={p.name}
                    onSelect={() => pick(p.id)}
                    className="gap-2"
                  >
                    <Folder className="size-3.5 shrink-0 opacity-60" />
                    <span
                      className={`truncate ${active ? 'font-medium text-foreground' : 'text-text-soft'}`}
                    >
                      {p.name}
                    </span>
                    {active && <Check className="ml-auto size-3 shrink-0 text-text-faint" />}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )}
        </CommandList>
        <CommandHints active="projects" />
      </Command>
    </CommandDialog>
  )
}
