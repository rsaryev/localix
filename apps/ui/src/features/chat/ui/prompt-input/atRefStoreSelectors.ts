import type { ChatStore } from '../../model/store'

// Disabled modes share stable sentinels so closed menus ignore streaming roster replacements.
const NO_SESSIONS: ChatStore['sessions'] = []
const NO_PROJECTS: ChatStore['projects'] = []

export const selectAtRefSessions = (state: Pick<ChatStore, 'sessions'>, enabled: boolean) =>
  enabled ? state.sessions : NO_SESSIONS

export const selectAtRefProjects = (state: Pick<ChatStore, 'projects'>, enabled: boolean) =>
  enabled ? state.projects : NO_PROJECTS

export const selectAtRefSessionMessages = (
  state: Pick<ChatStore, 'allSessions'>,
  sessionId: string | null,
  enabled: boolean,
) =>
  enabled ? state.allSessions.find((candidate) => candidate.id === sessionId)?.messages : undefined
