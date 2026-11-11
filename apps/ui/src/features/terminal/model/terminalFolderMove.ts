import { isAtOrUnder } from '@localixai/path-containment/ancestry'
import type { useChatStore } from '@/entities/chat/model/store'

type ChatState = ReturnType<typeof useChatStore.getState>

/** The folder of the project a chat belongs to, as the client last heard it. */
export function projectDirOf(state: ChatState, sessionId: string): string | undefined {
  const session =
    state.sessions.find((s) => s.id === sessionId) ??
    state.allSessions.find((s) => s.id === sessionId)
  return state.projects.find((project) => project.id === session?.projectId)?.workingDir
}

export interface TerminalFolderMove {
  /** The project folder the terminal started under. */
  from: string
  /** Where the project's folder is now. */
  to: string
  /** The terminal's directory at the same place inside the new folder. */
  cwd: string
}

/**
 * Whether the project this terminal started in was pointed at another folder since: a shell keeps
 * its directory, so it is left in a path that is gone. Only a terminal that started inside the
 * project's folder moves with it; one started elsewhere (a server in another folder) stays.
 */
export function terminalFolderMove(
  started: { cwd?: unknown; projectDir?: unknown },
  projectDir: string | undefined,
): TerminalFolderMove | null {
  const { cwd, projectDir: from } = started
  if (typeof cwd !== 'string' || typeof from !== 'string' || !projectDir) return null
  if (from === projectDir || !isAtOrUnder(from, cwd)) return null
  return { from, to: projectDir, cwd: projectDir + cwd.slice(from.length) }
}
