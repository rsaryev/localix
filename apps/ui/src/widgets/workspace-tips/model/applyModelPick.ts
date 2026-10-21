import type { ReasoningEffort } from '@localixai/agent'
import type { UiSession } from '@/shared/api/contracts'
import { findSessionInState } from '@/entities/chat/model/findSession'
import { isEmptyDraftSession } from '@/entities/chat/model/sessionListHelpers'

interface ChatState {
  activeSessionId: string | null
  sessions: readonly UiSession[]
  allSessions: readonly UiSession[]
  setModelSelection: (
    sessionId: string,
    connectionId: string,
    modelId: string,
    reasoningEffort?: ReasoningEffort,
  ) => Promise<void>
}

/**
 * The setup model pick, for the chat the launch opened under the setup dialog: that chat is a new
 * chat too, so it starts on the pick. A chat that already holds messages keeps its model.
 * Returns whether the chat was changed.
 */
export async function applyModelPickToOpenChat(
  state: ChatState,
  pick: { providerConnectionId: string; modelId: string; reasoningEffort?: ReasoningEffort },
): Promise<boolean> {
  const open = findSessionInState(state, state.activeSessionId)
  if (!open || !isEmptyDraftSession(open)) return false
  await state.setModelSelection(
    open.id,
    pick.providerConnectionId,
    pick.modelId,
    pick.reasoningEffort,
  )
  return true
}
