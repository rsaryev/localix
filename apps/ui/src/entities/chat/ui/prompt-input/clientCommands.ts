/**
 * Claude Code's habitual slash commands, run in the composer as thin wrappers: each calls an
 * action the app already has (its new-chat action, its chat picker, the rename the sidebar uses,
 * the rollback in the message menu, the permission-mode control, Settings navigation, the copy
 * button). This module only reads what was typed and says which action it asks for; the actions
 * come from the surface (`useClientCommands`), so one that has none — a chat that cannot be
 * rolled back from here — returns false and the text reaches the server, which says so.
 */
export interface ClientCommandActions {
  /** The app's new-chat action; false when this surface has none. */
  newChat: () => boolean
  /** Open a chat by id; null opens the chat picker. */
  resumeChat: (chatId: string | null) => void
  renameChat: (title: string) => void
  /** The message menu's rollback, confirmation included; false when this surface cannot. */
  rewind: (messageId: string) => boolean
  /** Switch to Plan mode, then send `task` when it is not empty. */
  planMode: (task: string) => void
  showContext: () => void
  /** Copy the nth latest assistant reply, 1 being the latest. */
  copyReply: (n: number) => void
  openSettings: (tab: 'permissions' | 'preferences') => void
  /** A one-line explanation for a command typed without what it needs. */
  usage: (message: string) => void
}

/** What `/copy` takes as its crumb: a positive whole number. */
const REPLY_NUMBER = /^[1-9]\d*$/

/** Run the command in `detected` through `actions`; false when it is not one of these. */
export function runClientCommand(
  detected: { command: { id: string }; text: string } | null,
  actions: ClientCommandActions,
): boolean {
  if (!detected) return false
  const argument = detected.text.trim()
  switch (detected.command.id) {
    case 'clear':
      return actions.newChat()
    case 'resume':
      actions.resumeChat(argument.split(/\s+/)[0] || null)
      return true
    case 'rename':
      if (argument) actions.renameChat(argument)
      else actions.usage('Usage: /rename <title>')
      return true
    case 'rewind': {
      const messageId = argument.split(/\s+/)[0]
      if (!messageId) {
        actions.usage('Pick the message to rewind to: /rewind <message>')
        return true
      }
      return actions.rewind(messageId)
    }
    case 'plan':
      actions.planMode(argument)
      return true
    case 'context':
      actions.showContext()
      return true
    case 'copy': {
      const reply = argument.split(/\s+/)[0] || '1'
      if (REPLY_NUMBER.test(reply)) actions.copyReply(Number(reply))
      else actions.usage('Pick which reply to copy: /copy <number>, 1 is the latest')
      return true
    }
    case 'permissions':
      actions.openSettings('permissions')
      return true
    case 'config':
      actions.openSettings('preferences')
      return true
    default:
      return false
  }
}
