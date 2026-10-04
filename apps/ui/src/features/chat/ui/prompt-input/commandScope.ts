import type { UiSession } from '@/shared/api/contracts'
import { findSessionInState } from '../../model/findSession'

interface ComposerProjectState {
  sessions: readonly Pick<UiSession, 'id' | 'projectId'>[]
  allSessions: readonly Pick<UiSession, 'id' | 'projectId'>[]
}

export function selectComposerProjectId(
  state: ComposerProjectState,
  sessionId: string | null,
): string | null {
  return findSessionInState(state, sessionId)?.projectId ?? null
}
