import { useState } from 'react'
import { ProjectFolderMenu } from '@/entities/chat/ui/ProjectFolderMenu'
import type { Project } from '@/shared/api/contracts'
import { backendClient } from '@/shared/api/client'
import { useChatStore } from '@/entities/chat/model/store'
import type { useQuickChat } from '../model/useQuickChat'

export function IslandFolderPicker({
  chat,
  projects,
  onRefresh,
  disabled = false,
}: {
  chat: ReturnType<typeof useQuickChat>
  projects: readonly Project[]
  onRefresh: () => void
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
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
  const addFolder = async () => {
    const directory = await backendClient.pickDirectory()
    if (!directory) return
    const normalize = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')
    const existing = projects.find(
      (project) => normalize(project.workingDir) === normalize(directory),
    )
    const project =
      existing ??
      (await useChatStore
        .getState()
        .createProject(normalize(directory).split('/').pop() || 'New Project', directory))
    await chat.startInProject(project.id)
    onRefresh()
  }
  return (
    <>
      <ProjectFolderMenu
        projects={projects}
        activeProjectId={chat.session?.projectId ?? null}
        disabled={disabled || busy || chat.running}
        presentation="toolbar"
        onPick={(id) => void act(() => chat.startInProject(id))}
        onAddFolder={() => void act(addFolder)}
      />
      {error && (
        <p role="alert" className="text-xs text-status-error">
          Could not open the folder. Try again.
        </p>
      )}
    </>
  )
}
