import { create } from 'zustand'

/** The selected question belongs to a chat, so switching surfaces cannot move its answer. */
export const useQuestionUiStore = create<{
  openBySession: Record<string, string | undefined>
  submittingBySession: Record<string, string | undefined>
  open: (sessionId: string, questionId: string) => void
  close: (sessionId: string, questionId: string) => void
  begin: (sessionId: string, questionId: string) => boolean
  finish: (sessionId: string, questionId: string) => void
}>((set, get) => ({
  openBySession: {},
  submittingBySession: {},
  open: (sessionId, questionId) =>
    set((state) => ({ openBySession: { ...state.openBySession, [sessionId]: questionId } })),
  close: (sessionId, questionId) => {
    if (get().openBySession[sessionId] !== questionId) return
    set((state) => ({ openBySession: { ...state.openBySession, [sessionId]: undefined } }))
  },
  begin: (sessionId, questionId) => {
    if (get().submittingBySession[sessionId]) return false
    set((state) => ({
      submittingBySession: { ...state.submittingBySession, [sessionId]: questionId },
    }))
    return true
  },
  finish: (sessionId, questionId) => {
    if (get().submittingBySession[sessionId] !== questionId) return
    set((state) => ({
      submittingBySession: { ...state.submittingBySession, [sessionId]: undefined },
    }))
  },
}))
