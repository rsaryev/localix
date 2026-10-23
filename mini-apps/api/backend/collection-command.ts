export const API_MINI_APP = 'api'
export const API_WORKSPACE_CHANNEL = 'workspace'

export interface ApiCollectionChangedCommand {
  type: 'collection_changed'
  target: 'request' | 'environment'
  action: string
}

/** Live lifecycle of a saved request sent by the agent. The response itself stays in history. */
export interface ApiRequestSendCommand {
  type: 'request_send'
  name: string
  phase: 'started' | 'completed' | 'failed'
}

export type ApiWorkspaceCommand = ApiCollectionChangedCommand | ApiRequestSendCommand

export function parseApiWorkspaceCommand(value: unknown): ApiWorkspaceCommand | null {
  if (!value || typeof value !== 'object') return null
  const command = value as {
    type?: unknown
    target?: unknown
    action?: unknown
    name?: unknown
    phase?: unknown
  }
  if (
    command.type === 'request_send' &&
    typeof command.name === 'string' &&
    command.name.trim() !== '' &&
    (command.phase === 'started' || command.phase === 'completed' || command.phase === 'failed')
  ) {
    return { type: 'request_send', name: command.name, phase: command.phase }
  }
  if (
    command.type !== 'collection_changed' ||
    (command.target !== 'request' && command.target !== 'environment') ||
    typeof command.action !== 'string'
  )
    return null
  return { type: 'collection_changed', target: command.target, action: command.action }
}
