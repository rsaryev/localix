import { useCallback, useEffect, useState } from 'react'
import { FolderX } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { StateNotice } from '@localixai/kit/state-notice'
import { baseName } from '@localixai/mini-app-sdk/ui/utilities'
import { backendClient } from '@/shared/api/client'
import { ApiError, failureSentence } from '@/shared/api/failure'
import { useSessionById } from '@/entities/chat/model/store'
import { toast } from '@/shared/lib/notify'

/** The refusal every folder-bound read answers when the project's folder is not usable (409). */
export const isWorkspaceFolderGone = (error: unknown): boolean =>
  error instanceof ApiError && (error.code?.startsWith('workspace_folder_') ?? false)

type FolderState = 'present' | 'missing' | 'not_a_directory' | 'unreadable'

const COPY: Record<Exclude<FolderState, 'present'>, { title: string; says: string }> = {
  missing: {
    title: 'Project folder not found',
    says: 'was moved, renamed or deleted. Its conversations keep their history: locate the folder to keep working in it.',
  },
  not_a_directory: {
    title: 'Project folder is now a file',
    says: 'is a file, not a folder. Locate the project’s folder to keep working in it.',
  },
  unreadable: {
    title: 'Localix can’t open the project folder',
    says: 'is there, but Localix may not read it. Check its permissions, or locate the folder.',
  },
}

/**
 * The Files pane when the project's folder is gone: what happened, and the way back. "Locate
 * folder…" re-points the PROJECT (every chat in it follows, history kept); a folder the server
 * can tell for certain is the same one moved is offered as one click, never applied on its own.
 * "Try again" asks the disk again, for a folder put back or a disk plugged in.
 */
export function MissingFolderNotice({
  sessionId,
  onResolved,
}: {
  sessionId: string
  /** The folder is usable again (relocated or back): the tree re-reads it. */
  onResolved: () => void
}) {
  const projectId = useSessionById(sessionId)?.projectId ?? null
  const [folder, setFolder] = useState<{
    path: string
    state: FolderState
    suggestion: string | null
  } | null>(null)
  const [busy, setBusy] = useState(false)

  const check = useCallback(async () => {
    if (!projectId) return
    const next = await backendClient.projectFolder(projectId).catch(() => null)
    if (next?.state === 'present') onResolved()
    else setFolder(next)
  }, [projectId, onResolved])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the folder's status is read once per mount; Try again reads it again
    void check()
  }, [check])

  const relocate = async (path: string) => {
    if (!projectId) return
    setBusy(true)
    try {
      const { memory, trust } = await backendClient.relocateProject(projectId, path)
      toast.success(`The project now uses “${baseName(path)}”`, {
        description: memory === 'copied' ? 'Its Claude Code memory was copied along.' : undefined,
      })
      if (trust.before && !trust.after)
        toast.info('Claude Code has not trusted this folder yet', {
          description:
            'Its project hooks, MCP servers and settings stay off until you open it in Claude Code and accept the trust dialog.',
        })
      onResolved()
    } catch (error) {
      toast.error('Could not use that folder', {
        description: failureSentence(error, 'The project still points at its old folder.'),
      })
    } finally {
      setBusy(false)
    }
  }

  const locate = async () => {
    const picked = await backendClient.pickDirectory().catch(() => null)
    if (picked) await relocate(picked)
  }

  const copy = COPY[folder?.state === 'present' || !folder ? 'missing' : folder.state]
  const suggestion = folder?.suggestion ?? null
  return (
    <StateNotice
      icon={FolderX}
      role="status"
      title={copy.title}
      body={
        <>
          {folder ? <span className="break-all font-mono">{folder.path}</span> : 'The folder'}{' '}
          {copy.says}
        </>
      }
      actionsLabel="Project folder actions"
      actions={
        <>
          {suggestion && (
            <Button
              size="sm"
              disabled={busy}
              title={suggestion}
              onClick={() => void relocate(suggestion)}
            >
              Use “{baseName(suggestion)}”
            </Button>
          )}
          <Button
            size="sm"
            variant={suggestion ? 'secondary' : 'default'}
            disabled={busy || !projectId}
            onClick={() => void locate()}
          >
            Locate folder…
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void check()}>
            Try again
          </Button>
        </>
      }
    />
  )
}
