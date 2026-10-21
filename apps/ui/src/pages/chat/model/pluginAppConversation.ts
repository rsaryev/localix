import { backendClient } from '@/shared/api/client'
import type { UiSession } from '@/shared/api/contracts'
import { applyServerSession } from '@/entities/chat/model/sessionSync'
import { useChatStore } from '@/entities/chat/model/store'
import { viewStateStore } from '@/shared/lib/view-state/store'
import { pluginAppViewState, type PluginAppContext } from '@/shared/lib/pluginApp'

type Conversation = Pick<
  UiSession,
  'id' | 'projectId' | 'parentSessionId' | 'isArchived' | 'updatedAt'
>

/** One of the app's own conversations: in its project, a root, not archived. */
const isAppConversation = (session: Conversation, projectId: string) =>
  session.projectId === projectId && !session.parentSessionId && !session.isArchived

/** The newest of the app's conversations. */
export function latestConversation(
  sessions: readonly Conversation[],
  projectId: string,
): string | null {
  let latest: Conversation | null = null
  for (const session of sessions) {
    if (!isAppConversation(session, projectId)) continue
    if (!latest || session.updatedAt > latest.updatedAt) latest = session
  }
  return latest?.id ?? null
}

/**
 * Which conversation the app opens on: the one it last showed while that is still one of its
 * own, else its newest, else a new one. Read from the hydrated roster, which already carries each
 * conversation's project; loading a transcript only to read that is what the URL sync stopped doing.
 */
export async function appConversation(app: PluginAppContext, projectId: string): Promise<string> {
  const selected = await viewStateStore.ready(pluginAppViewState(app.plugin))
  const remembered =
    selected.value && 'sessionId' in selected.value ? selected.value.sessionId : null
  const roster = useChatStore.getState().allSessions
  const kept = roster.find((session) => session.id === remembered)
  if (kept && isAppConversation(kept, projectId)) return kept.id
  return latestConversation(roster, projectId) ?? startConversation(projectId)
}

/** A new conversation in the app's project, named the way every new conversation is. */
export async function startConversation(projectId: string): Promise<string> {
  const session = await backendClient.createSession({ projectId })
  applyServerSession(session)
  return session.id
}
