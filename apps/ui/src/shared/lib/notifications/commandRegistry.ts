import { originSession } from './origin'
import type {
  NotificationAction,
  NotificationCommand,
  NotificationEntry,
  SessionCoordinates,
} from './types'

export interface NotificationCommandContext {
  entry: NotificationEntry
  action: NotificationAction
  target: SessionCoordinates | null
}

export type NotificationCommandHandler = (
  context: NotificationCommandContext,
) => void | Promise<void>

const handlers = new Map<NotificationCommand, NotificationCommandHandler>()
const subscribers = new Set<() => void>()
const COMMAND_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/u
let revision = 0

function emitChange(): void {
  revision += 1
  for (const subscriber of subscribers) subscriber()
}

export function isNotificationCommand(value: unknown): value is NotificationCommand {
  return typeof value === 'string' && COMMAND_PATTERN.test(value)
}

/** Register one command owner. Duplicate ownership is a configuration error. */
export function registerNotificationCommand(
  command: NotificationCommand,
  handler: NotificationCommandHandler,
): () => void {
  if (!isNotificationCommand(command)) throw new Error('Invalid notification command')
  if (handlers.has(command)) throw new Error(`Notification command already registered: ${command}`)
  handlers.set(command, handler)
  emitChange()
  return () => {
    if (handlers.get(command) !== handler) return
    handlers.delete(command)
    emitChange()
  }
}

export function notificationCommandAvailable(
  action: NotificationAction,
  atRevision = revision,
  now = Date.now(),
): boolean {
  if (atRevision !== revision) return false
  if (!action.available) return false
  if (action.expiresAt != null && now >= action.expiresAt) return false
  if (action.kind !== 'invoke') return action.kind !== 'callback' || Boolean(action.onClick)
  return Boolean(action.onClick) || Boolean(action.command && handlers.has(action.command))
}

export function subscribeNotificationCommands(subscriber: () => void): () => void {
  subscribers.add(subscriber)
  return () => subscribers.delete(subscriber)
}

export function notificationCommandRevision(): number {
  return revision
}

/** Execute a serializable action without teaching the journal about its domain. */
export async function executeNotificationCommand(
  entry: NotificationEntry,
  action: NotificationAction,
): Promise<boolean> {
  if (action.kind !== 'invoke' || !action.command) return false
  const handler = handlers.get(action.command)
  if (!handler) return false
  await handler({
    entry,
    action,
    target: action.target ?? originSession(entry.origin),
  })
  return true
}

export function resetNotificationCommandsForTests(): void {
  if (handlers.size === 0) return
  handlers.clear()
  emitChange()
}
