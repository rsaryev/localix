import { backendClient } from '@/shared/api/client'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { inspector, isInspectorReady } from './inspectorBus'
import { pageOpenChatInProject, subscribePageOpenChat } from './pageOpenChat'
import { runtimeReadyBarrier } from './runtimeReady'
import { toast } from './notify'
import { scopePath } from '@/shared/routing/routes'
import { tauriFrontendLog } from './tauri'

/**
 * Wait for BOTH the destination chat and its inspector bridge. An OS open request is
 * queued and survives startup instead of sampling the outgoing UI.
 * The page publishes after its grid has switched scope; opening earlier either lost the
 * file or placed it in the previous project's conversation.
 */
export function openDeepLinkFile(
  projectId: string,
  filePath: string,
  timeoutMs = 15_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      unsubscribeChat()
      unsubscribeInspector()
      clearTimeout(timer)
    }
    const open = () => {
      const sessionId = pageOpenChatInProject(projectId)
      if (settled || !sessionId || !isInspectorReady()) return
      settled = true
      cleanup()
      inspector.openFile({ sessionId, path: filePath, solo: true })
      tauriFrontendLog('files.open', JSON.stringify({ projectId, sessionId, path: filePath }))
      resolve()
    }
    const unsubscribeChat = subscribePageOpenChat(open)
    const unsubscribeInspector = inspector.subscribeOpenChange(open)
    const timer = setTimeout(() => {
      settled = true
      cleanup()
      reject(new Error('The destination workspace did not become ready.'))
    }, timeoutMs)
    open()
  })
}

/** Resolve only after the sidecar starts, then retain the file until navigation settles. */
export async function openDeepLinkPath(path: string): Promise<void> {
  try {
    await runtimeReadyBarrier()
    const delays = [0, 500, 1000, 2000, 4000, 8000]
    let resolved: Awaited<ReturnType<typeof backendClient.resolveProjectByPath>> | undefined
    let lastError: unknown
    for (const delay of delays) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
      try {
        resolved = await backendClient.resolveProjectByPath(path)
        break
      } catch (error) {
        lastError = error
      }
    }
    if (!resolved) throw lastError
    const { project, filePath } = resolved
    window.location.hash = `#${scopePath(project.id)}`
    if (filePath) await openDeepLinkFile(project.id, filePath)
    console.info('[localix] open intent handled', { path, project: project.id, filePath })
  } catch (error) {
    console.warn('[localix] open intent failed', { path, error })
    tauriFrontendLog(
      'files.open.failed',
      `${path}: ${errorMessage(error, 'Path resolution failed.')}`,
    )
    toast.error(`Could not open “${path}”`, {
      description: errorMessage(error, 'The local service did not resolve that path.'),
    })
  }
}
