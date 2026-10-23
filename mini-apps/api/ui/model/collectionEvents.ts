import { miniAppCommandBus, type MiniAppCommandEvent } from '@localixai/mini-app-sdk/ui/commands'
import {
  API_WORKSPACE_CHANNEL,
  API_MINI_APP,
  parseApiWorkspaceCommand,
  type ApiWorkspaceCommand,
} from '../../backend/collection-command'

/** A command and the chat whose agent issued it. */
type Listener = (command: ApiWorkspaceCommand, sessionId: string) => void
const listeners = new Set<Listener>()

/**
 * Deliver every chat's command, with its chat, and let each surface decide.
 *
 * This used to drop every command not from the chat on screen, back when the workspace was one
 * tab following the active chat. Each chat now has its own workspace, so that filter starved a
 * background chat's workspace of its own agent's saves and sends. A "something changed" refresh is
 * safe from any chat — the listener re-reads its OWN session — while a per-request fact (the agent
 * is sending this one) is matched against the listener's session by the listener.
 */
export function handleApiWorkspaceCommand(event: MiniAppCommandEvent): void {
  const command = parseApiWorkspaceCommand(event.payload)
  if (!command) return
  for (const listener of Array.from(listeners)) listener(command, event.sessionId)
}

let initialized = false

export function initApiWorkspaceCommands(): void {
  if (initialized) return
  initialized = true
  miniAppCommandBus.register(API_MINI_APP, API_WORKSPACE_CHANNEL, handleApiWorkspaceCommand)
}

export function subscribeApiWorkspaceCommands(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
