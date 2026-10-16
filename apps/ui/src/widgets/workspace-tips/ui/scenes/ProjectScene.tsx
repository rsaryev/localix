import { Check, ChevronDown, Folder, FolderPlus } from 'lucide-react'
import { useChatStore } from '@/features/chat/model/store'
import { useAddProjectFolder } from '@/features/chat/model/useAddProjectFolder'
import { useRoutedNavigation } from '@/shared/hooks/useRoutedNavigation'
import { TipPick } from '../TipPick'
import './project-scene.css'

/**
 * The breadcrumb's project menu as it really reads: "Add project…", the user's own
 * projects with the current one checked, and the workspace search. The pointer takes
 * "Add project…" and the breadcrumb then names the folder that was opened.
 */
export function ProjectScene() {
  const projects = useChatStore((s) => s.projects)
  const current = projects.find((p) => p.isDefault) ?? projects[0]
  const currentName = current?.name ?? 'Default'
  const others = projects
    .filter((p) => p.id !== current?.id)
    .slice(0, 2)
    .map((p) => p.name)

  return (
    <div aria-hidden className="wt-project">
      <div className="wt-pane wt-project-window">
        <div className="wt-topbar">
          <span className="wt-crumb">
            <Folder className="size-2.5" />
            <span className="wt-swap">
              <span className="wt-p-a">{currentName}</span>
              <span className="wt-p-b">my-app</span>
            </span>
            <ChevronDown className="size-2" />
          </span>
          <span className="text-text-faint">/</span>
          <span className="wt-crumb-chat">
            New Chat <ChevronDown className="size-2" />
          </span>
        </div>
        <div className="wt-project-body">
          <span className="wt-skel" style={{ width: '42%' }} />
          <span className="wt-skel" style={{ width: '64%' }} />
          <span className="wt-skel" style={{ width: '30%' }} />
        </div>
      </div>

      <div className="wt-pane wt-menu">
        <span className="wt-hover" />
        <span className="wt-row">
          <FolderPlus /> Add project…
        </span>
        {others.map((name) => (
          <span key={name} className="wt-row">
            <Folder /> {name}
          </span>
        ))}
        <span className="wt-row wt-current">
          <Folder /> {currentName}
          <Check className="ml-auto" />
        </span>
        <span className="wt-menu-search">Search all workspaces…</span>
      </div>
    </div>
  )
}

/** The breadcrumb's project menu in short: the folders already open, and Add folder…. */
export function ProjectAction() {
  const addProjectFolder = useAddProjectFolder()
  const nav = useRoutedNavigation()
  const projects = useChatStore((s) => s.projects)
  const activeId = useChatStore((s) => s.activeProjectId)
  const folders = projects.filter((p) => !p.isDefault)
  const active = folders.find((p) => p.id === activeId)
  return (
    <TipPick
      label="Project"
      value={active?.name ?? 'choose a folder'}
      entries={[
        ...folders.map((p) => ({
          id: p.id,
          label: p.name,
          icon: Folder,
          selected: p.id === activeId,
          onSelect: () => nav.switchProject(p.id),
        })),
        { separator: true as const },
        {
          id: 'add-folder',
          label: 'Add folder…',
          icon: FolderPlus,
          onSelect: () => void addProjectFolder(),
        },
      ]}
    />
  )
}
