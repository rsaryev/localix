import type { AgentStreamEvent } from '@/shared/api/contracts'

type PreviewFrame<T extends AgentStreamEvent['type']> = Extract<AgentStreamEvent, { type: T }>

/**
 * What a conversation asks of the previews it opened. The chat stream and the chat store say
 * what happened; the inspector, which owns the previews, decides what that does to them. The app
 * installs the inspector's implementation, so the chat feature never imports the inspector.
 */
export interface SessionPreviews {
  updated(sessionId: string, frame: PreviewFrame<'preview.updated'>): void
  command(sessionId: string, frame: PreviewFrame<'preview.command'>): void
  closed(sessionId: string, frame: PreviewFrame<'preview.closed'>): void
  /** Deleted conversations: close their pages and drop their previews. */
  forget(sessionIds: readonly string[]): void
  /** A click that opens `url` as a preview of the conversation, reporting a refusal. */
  open(sessionId: string, url: string): void
}

let active: { owner: symbol; previews: SessionPreviews } | undefined

export function registerSessionPreviews(previews: SessionPreviews): () => void {
  const owner = Symbol('session-previews')
  active = { owner, previews }
  return () => {
    if (active?.owner === owner) active = undefined
  }
}

/** The installed previews; with none (a window that shows no previews) every call is a no-op. */
export function sessionPreviews(): SessionPreviews {
  return active?.previews ?? NONE
}

const NONE: SessionPreviews = {
  updated: () => {},
  command: () => {},
  closed: () => {},
  forget: () => {},
  open: () => {},
}
