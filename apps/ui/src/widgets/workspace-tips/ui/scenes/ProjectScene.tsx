import { Check, ChevronDown, Folder, FolderPlus } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { useChatStore } from '@/features/chat/model/store'
import { useAddProjectFolder } from '@/features/chat/model/useAddProjectFolder'
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

export function ProjectAction() {
  const addProjectFolder = useAddProjectFolder()
  return (
    <Button variant="secondary" size="lg" onClick={() => void addProjectFolder()}>
      <FolderPlus data-icon="inline-start" aria-hidden />
      Add project folder
    </Button>
  )
}
