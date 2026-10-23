import { toast } from '@localixai/mini-app-sdk/ui'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { miniAppTerminal } from '@localixai/mini-app-sdk/ui/runtime'

/**
 * Spawn a shell command in the workspace terminal and adopt it as a terminal tab.
 * Reuses the EXISTING terminal PTY + editor-grid terminal tab machinery via the
 * shared terminal bus — no parallel terminal machinery.
 *
 * A spawn that fails is REPORTED, never swallowed. It used to be caught and dropped
 * on the theory that "the terminal pane surfaces its own errors" — but a rejected
 * spawn never gets a pane, so "Exec" or "Run" simply did nothing. It still resolves
 * rather than throws, because every caller is a click handler with nothing to add.
 *
 * Shared by `docker exec` into a container and the Dockerfile/Compose Run bar.
 *
 * `sessionId` is the chat of the surface that asked — the container tab's or the manifest
 * editor's. It used to be `null`, which the host read as "the chat on screen" (or an unbound
 * shell in $HOME), so a Run from a tab of chat A opened its terminal in chat B.
 */
export async function spawnInTerminal(
  sessionId: string,
  command: string,
  title: string,
): Promise<void> {
  try {
    await miniAppTerminal.spawnCommand({ command, sessionId, title })
  } catch (cause) {
    toast.error(`Could not open “${title}” in a terminal`, {
      description: errorMessage(cause, '') || undefined,
    })
  }
}
