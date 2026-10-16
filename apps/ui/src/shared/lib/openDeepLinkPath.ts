import { backendClient } from '@/shared/api/client'
import { ApiError } from '@/shared/api/failure'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { inspector, isInspectorReady } from './inspectorBus'
import { pageOpenChatCurrent, subscribePageOpenChat } from './pageOpenChat'
import { runtimeReadyBarrier } from './runtimeReady'
import { toast } from './notify'
import { scopePath } from '@/shared/routing/routes'
import { tauriFrontendLog } from './tauri'

/** Back-off for a sidecar that is up but not yet answering (a cold launch). */
const INSPECT_RETRY_DELAYS = [0, 500, 1000, 2000, 4000, 8000]

/**
 * Open a file in the chat that is on screen, without changing the project or the layout. Waits
 * for a chat to be published (a cold launch) and for the inspector, then reveals the file there
 * like any other file open: in the editor group, beside the chat, never over it.
 */
export function openFileInCurrentChat(filePath: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      unsubscribeChat()
      unsubscribeInspector()
      clearTimeout(timer)
    }
    const open = () => {
      const sessionId = pageOpenChatCurrent()
      if (settled || !sessionId || !isInspectorReady()) return
      settled = true
      cleanup()
      inspector.openFile({ sessionId, path: filePath })
      tauriFrontendLog('files.open', JSON.stringify({ sessionId, path: filePath }))
      resolve()
    }
    const unsubscribeChat = subscribePageOpenChat(open)
    const unsubscribeInspector = inspector.subscribeOpenChange(open)
    const timer = setTimeout(() => {
      settled = true
      cleanup()
      reject(new Error('No conversation was ready to show the file.'))
    }, timeoutMs)
    open()
  })
}

/** A request the server refused (a missing or relative path) fails the same way on every retry. */
const isFinal = (error: unknown) =>
  error instanceof ApiError && error.status >= 400 && error.status < 500

async function inspectWithRetry(path: string) {
  let lastError: unknown
  for (const delay of INSPECT_RETRY_DELAYS) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    try {
      return await backendClient.inspectPath(path)
    } catch (error) {
      if (isFinal(error)) throw error
      lastError = error
    }
  }
  throw lastError
}

/**
 * Handle an OS open (`localix <path>`, Finder "Open With", a file association). A FILE opens in the
 * chat already on screen and never creates or switches a project — the same as a dropped file. Only
 * a DIRECTORY finds or creates its project and navigates there.
 */
export async function openDeepLinkPath(path: string): Promise<void> {
  try {
    await runtimeReadyBarrier()
    const inspected = await inspectWithRetry(path)
    if (inspected.kind === 'file') {
      await openFileInCurrentChat(inspected.path)
      console.info('[localix] open intent handled', { path, kind: 'file' })
      return
    }
    const { project } = await backendClient.resolveProjectByPath(inspected.path)
    window.location.hash = `#${scopePath(project.id)}`
    console.info('[localix] open intent handled', { path, kind: 'directory', project: project.id })
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
