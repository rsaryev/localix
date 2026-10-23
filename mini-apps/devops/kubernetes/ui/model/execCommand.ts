import { miniAppTerminal } from '@localixai/mini-app-sdk/ui/runtime'
import { kubernetesApi } from '../api/kubernetesApi'

export interface ExecPodTarget {
  /** The chat whose terminal opens the shell — the pod tab's own session. `null` used to mean
   *  "the chat on screen", so a pod tab of chat A opened its shell in chat B. */
  sessionId: string
  pod: string
  namespace: string
  context?: string
  /** Container to exec into (multi-container pods); omitted ⇒ the pod's default. */
  container?: string
}

/**
 * Open an interactive Kubernetes API exec shell in the workspace terminal.
 * Reuses the EXISTING terminal PTY + editor-grid terminal tab machinery (identical to
 * the container workbench's `execIntoContainer`) — a PTY is spawned server-side and adopted as a
 * terminal tab through the shared terminal bus. Setup failures propagate so the
 * initiating pod tab can render them inline.
 */
export async function execIntoPod(target: ExecPodTarget): Promise<void> {
  const command = await kubernetesApi.execCommand(
    target.pod,
    target.namespace,
    target.context,
    target.container,
  )
  await miniAppTerminal.spawnCommand({
    command,
    sessionId: target.sessionId,
    title: `${target.pod} · Shell`,
  })
}
