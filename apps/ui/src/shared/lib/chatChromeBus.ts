import { createEventChannel } from './eventChannel'

/**
 * Seam between the in-column chat header (the {@link UnifiedBreadcrumb}, now
 * rendered per chat surface deep in the editor grid) and the page-level chrome
 * that owns the modal switchers + new-chat action (`ChatPage`).
 *
 * The breadcrumb's inline segment dropdowns handle switching themselves; these
 * events cover only the "escape to the full modal" (Search all…) and New-chat
 * affordances, which live at the page. Mirrors {@link workspaceChromeBus}:
 * coordination through `shared` keeps the dependency arrow one-directional
 * (widgets/features → shared ← pages) instead of threading callbacks through the
 * grid registry.
 */

type ChromeEvent = 'project-switcher' | 'session-switcher' | 'new-chat'
type ChromeListener = (event: ChromeEvent) => void

const channel = createEventChannel<[event: ChromeEvent]>()

function emit(event: ChromeEvent): void {
  channel.publish(event)
}

/** Open the full project/workspace switcher modal (Search all…). */
export const openProjectSwitcher = (): void => emit('project-switcher')
/** Open the full session switcher modal (Search all…). */
export const openSessionSwitcher = (): void => emit('session-switcher')
/** Start a new chat in the active scope. */
export const requestNewChat = (): void => emit('new-chat')

/** Subscribe to chat-chrome requests; returns an unsubscribe for teardown/HMR. */
export function subscribeChatChrome(listener: ChromeListener): () => void {
  return channel.subscribe(listener)
}
