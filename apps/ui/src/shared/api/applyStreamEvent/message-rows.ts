/**
 * Whole transcript rows: a row created, replaced by a newer snapshot, or removed. The live
 * growth of a row between snapshots is `message-delta.ts`.
 */
import { isToolBackedItem } from '@localixai/agent/agents/items'
import { replaceParticipantUsage, replaceUsageInSummary } from '@localixai/agent'

import type { AgentStreamEvent, UiSession } from '../contracts'
import { toUiMessage } from '../converters'
import { remapMessageAnchors } from '../messageAnchorRemap'
import type { StreamReducers } from './types'

/** Unknown historical message mutations require an authoritative session snapshot.
 * A windowed client has no previous usage payload to subtract from sessionUsage. */
export function needsSessionResync(session: UiSession, event: AgentStreamEvent): boolean {
  if (event.type === 'message.updated') {
    return (
      event.sessionId === session.id &&
      !session.messages.some((message) => message.id === event.message.id)
    )
  }
  if (event.type === 'message.delta' || event.type === 'message.removed') {
    return (
      event.sessionId === session.id &&
      !session.messages.some((message) => message.id === event.messageId)
    )
  }
  return false
}

/**
 * A new durable row goes where the server put it: before any optimistic row still waiting for its
 * echo. Those rows stand for messages the server has not written yet, so whatever it writes now —
 * a membership line from an edit made after Enter, a hand-off reply landing while a send is
 * queued — precedes them on the branch. Appending after them kept a notice under the agent's
 * reply once the skeleton was claimed in place, until a reload restored the server order.
 */
function insertBeforePending(
  messages: UiSession['messages'],
  message: UiSession['messages'][number],
): UiSession['messages'] {
  const pending = messages.findIndex((existing) => existing.optimistic)
  if (pending === -1) return [...messages, message]
  return [...messages.slice(0, pending), message, ...messages.slice(pending)]
}

export const messageRowReducers: StreamReducers<
  'message.created' | 'message.updated' | 'message.removed'
> = {
  'message.created': (session, event) => {
    if (event.sessionId !== session.id) return session
    const message = toUiMessage(event.message)
    const previousMessage = session.messages.find((existing) => existing.id === message.id)
    const exists = session.messages.some((existing) => existing.id === message.id)
    // The composer paints optimistic placeholder rows on Enter (your message +
    // the assistant's "working" skeleton) so the send has no dead air. The real
    // echo takes the placeholder's slot instead of appending beside it. User
    // rows carry exact client ids; a queued band can represent several
    // optimistic rows, which collapse into its one persisted turn here.
    // Legacy echoes fall back to role/FIFO. A correlated echo from another tab
    // must never consume an unrelated local placeholder.
    const correlatedIds =
      message.role === 'user' && message.clientMessageIds?.length
        ? new Set(message.clientMessageIds)
        : null
    const correlatedOptimisticIndexes: number[] = []
    if (correlatedIds) {
      for (let index = 0; index < session.messages.length; index += 1) {
        const candidate = session.messages[index]
        if (candidate?.optimistic && candidate.role === 'user' && correlatedIds.has(candidate.id)) {
          correlatedOptimisticIndexes.push(index)
        }
      }
    }
    const optimisticCommandIdx = message.commandOutput
      ? session.messages.findIndex(
          (candidate) =>
            candidate.optimistic &&
            candidate.role === 'system' &&
            candidate.commandOutput?.activity?.state === 'running' &&
            candidate.commandOutput.command === message.commandOutput?.command,
        )
      : -1
    const optimisticIdx =
      exists || message.isInternal
        ? -1
        : optimisticCommandIdx !== -1
          ? optimisticCommandIdx
          : message.uiOnly
            ? -1
            : correlatedIds
              ? (correlatedOptimisticIndexes[0] ?? -1)
              : session.messages.findIndex((m) => m.optimistic && m.role === message.role)
    // Claiming swaps the placeholder's id for the server id in the SAME slot —
    // carry the placeholder's identity as `renderKey` so the row's React key is
    // stable across the swap (no remount: the typing status keeps typing).
    const placeholder = optimisticIdx !== -1 ? session.messages[optimisticIdx] : undefined
    const claimed = placeholder
      ? { ...message, renderKey: placeholder.renderKey ?? placeholder.id }
      : previousMessage?.renderKey
        ? { ...message, renderKey: previousMessage.renderKey }
        : message
    const messages =
      correlatedOptimisticIndexes.length > 0
        ? session.messages.flatMap((existing, index) => {
            if (index === optimisticIdx) return [claimed]
            return correlatedOptimisticIndexes.includes(index) ? [] : [existing]
          })
        : optimisticIdx !== -1
          ? session.messages.map((m, i) => (i === optimisticIdx ? claimed : m))
          : exists
            ? session.messages.map((existing) => (existing.id === message.id ? claimed : existing))
            : insertBeforePending(session.messages, message)
    const anchorRemap = new Map<string, string>()
    if (
      !message.isInternal &&
      !message.uiOnly &&
      message.role !== 'system' &&
      (optimisticIdx !== -1 || exists)
    ) {
      if (correlatedOptimisticIndexes.length > 0) {
        for (const index of correlatedOptimisticIndexes) {
          const optimisticId = session.messages[index]?.id
          if (optimisticId) anchorRemap.set(optimisticId, message.id)
        }
      } else if (placeholder) {
        anchorRemap.set(placeholder.id, message.id)
      }
    }
    return {
      ...session,
      messages: remapMessageAnchors(messages, anchorRemap),
      participantUsage: replaceParticipantUsage(session.participantUsage, previousMessage, message),
      sessionUsage: replaceUsageInSummary(
        session.sessionUsage,
        previousMessage?.usage,
        message.usage,
      ),
      // Keep the persisted count fresh so a thread's size indicator (read from
      // this session object on the parent) updates as you reply in the thread.
      messageCount: exists ? session.messageCount : (session.messageCount ?? 0) + 1,
      // A fresh assistant message during a run is the stream target from now on.
      streamingMessageId:
        message.role === 'assistant' && session.isRunning
          ? message.id
          : (session.streamingMessageId ?? null),
      updatedAt: Date.now(),
    }
  },

  'message.updated': (session, event) => {
    if (event.sessionId !== session.id) return session
    const message = toUiMessage(event.message)
    const previousMessage = session.messages.find((existing) => existing.id === message.id)
    // Appending an unknown historical update can double-count all-history
    // sessionUsage. The event runtime will fetch an authoritative snapshot.
    if (!previousMessage) return session
    return {
      ...session,
      messages: session.messages.map((existing) => {
        if (existing.id !== message.id) return existing
        // Reference stability for settled TOOL items only: each SSE snapshot is
        // a fresh JSON.parse, so every item is a new object and the memoized
        // item view would re-render every completed card on every delta. A
        // terminal status alone does not make the payload immutable: a later
        // authoritative snapshot may correct its output or metadata. Reuse only
        // equal wire payloads so those corrections reach the card. Narrative text/reasoning items
        // are NEVER frozen: they grow token-by-token during streaming (the
        // accumulator marks them 'completed' immediately), so freezing them
        // would stall the visible text mid-stream until a reload.
        const next = message.items
        const prev = existing.items
        if (next?.length && prev?.length) {
          const prevById = new Map(prev.map((it) => [it.id, it]))
          const deferredIds = new Set(existing.deferredToolItemIds ?? [])
          let reused = false
          const stabilized = next.map((it) => {
            if (!isToolBackedItem(it)) return it
            const old = prevById.get(it.id)
            const terminal =
              it.status === 'completed' || it.status === 'failed' || it.status === 'aborted'
            if (
              old &&
              old.status === it.status &&
              terminal &&
              !deferredIds.has(it.id) &&
              JSON.stringify(old) === JSON.stringify(it)
            ) {
              reused = true
              return old
            }
            return it
          })
          if (reused) message.items = stabilized
        }
        // Streaming updates bypass listMessages and carry no branch metadata;
        // preserve the previously-computed switcher state across updates.
        const stableMessage =
          existing.renderKey && message.renderKey !== existing.renderKey
            ? { ...message, renderKey: existing.renderKey }
            : message
        return stableMessage.branchCount === undefined && existing.branchCount !== undefined
          ? {
              ...stableMessage,
              branchIndex: existing.branchIndex,
              branchCount: existing.branchCount,
            }
          : stableMessage
      }),
      participantUsage: replaceParticipantUsage(session.participantUsage, previousMessage, message),
      sessionUsage: replaceUsageInSummary(
        session.sessionUsage,
        previousMessage.usage,
        message.usage,
      ),
      // Streaming deltas must NOT reorder the sidebar: bumping updatedAt on every token makes
      // two concurrently-streaming chats swap places several times a second. An in-place
      // update keeps the session's position; message.created bumped it when the row appeared.
      updatedAt: session.updatedAt,
    }
  },

  'message.removed': (session, event) => {
    if (event.sessionId !== session.id) return session
    const previousMessage = session.messages.find((message) => message.id === event.messageId)
    if (!previousMessage) return session
    return {
      ...session,
      messages: session.messages.filter((message) => message.id !== event.messageId),
      // `sessionUsage` is the server's ALL-history total while `messages` may be
      // only a rendered/windowed tail. Remove exactly this persisted row's
      // contribution instead of re-summing the loaded window (which would drop
      // every unloaded turn), which keeps rollback/branch mutations honest without
      // waiting for a reconnect snapshot.
      participantUsage: replaceParticipantUsage(
        session.participantUsage,
        previousMessage,
        undefined,
      ),
      sessionUsage: replaceUsageInSummary(session.sessionUsage, previousMessage.usage, undefined),
      messageCount: Math.max(0, (session.messageCount ?? session.messages.length) - 1),
      updatedAt: Date.now(),
    }
  },
}
