import { baseName } from '@localixai/mini-app-sdk/ui/utilities'
import { backendClient } from '@/shared/api/client'
import { failureSentence } from '@/shared/api/failure'
import { toast } from '@/shared/lib/notify'

/**
 * Point a project at another folder and say what followed: the ONE way the client does it, from the
 * project's settings and from the notice a missing folder shows. Its chats follow with their
 * history; Claude Code's memory is copied; Claude Code's trust is not, and the person is told when
 * that turns project hooks off. True when the project now uses `path`.
 */
export async function relocateProjectFolder(projectId: string, path: string): Promise<boolean> {
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
    return true
  } catch (error) {
    toast.error('Could not use that folder', {
      description: failureSentence(error, 'The project still points at its old folder.'),
    })
    return false
  }
}

/** Ask for a folder and point the project at it; false when the pick was cancelled or refused. */
export async function chooseProjectFolder(projectId: string): Promise<boolean> {
  const picked = await backendClient.pickDirectory().catch(() => null)
  return picked ? relocateProjectFolder(projectId, picked) : false
}
