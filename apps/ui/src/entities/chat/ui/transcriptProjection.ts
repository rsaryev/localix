import type { Message } from '../model/types'
import { projectContinuationItems } from '@localixai/agent'
import {
  coalesceSystemMessages,
  groupSystemActivity,
  isSystemActivity,
} from './coalesceSystemMessages'

export interface TranscriptProjectionMetrics {
  mode: 'full' | 'append' | 'tail'
  messagesVisited: number
}

interface ProjectionResult {
  projected: readonly Message[]
  identity: boolean
  hasNotices: boolean
}

function buildTranscriptProjection(messages: readonly Message[]): ProjectionResult {
  const original = messages
  messages = projectContinuationItems(messages)
  const notices: Message[] = []
  const realIds = new Set<string>()
  let hasInternal = false
  for (const message of messages) {
    if (message.isInternal) {
      hasInternal = true
      continue
    }
    if (message.role === 'system') notices.push(message)
    else realIds.add(message.id)
  }
  if (notices.length === 0) {
    return hasInternal
      ? {
          projected: messages.filter((message) => !message.isInternal),
          identity: false,
          hasNotices: false,
        }
      : { projected: messages, identity: messages === original, hasNotices: false }
  }

  // Interleave each system notice right after its anchor message (the message it
  // followed when created), so it keeps its chronological spot rather than the
  // raw array order (which a refetch appends notices to the end of).
  const byAnchor = new Map<string, Message[]>()
  const leading: Message[] = []
  const trailing: Message[] = []
  for (const notice of notices) {
    const anchor = notice.afterMessageId
    // `null` explicitly means before the first message. `undefined` is a
    // durable server row whose raw sequence is already authoritative, so it is
    // emitted in-place by the loop below instead of drifting to the top.
    if (anchor === null) leading.push(notice)
    else if (anchor === undefined) continue
    else if (realIds.has(anchor)) {
      const list = byAnchor.get(anchor) ?? []
      list.push(notice)
      byAnchor.set(anchor, list)
    } else trailing.push(notice)
  }

  const projected: Message[] = [...leading]
  for (const message of messages) {
    if (message.isInternal) continue
    if (message.role === 'system') {
      if (message.afterMessageId === undefined) projected.push(message)
      continue
    }
    const after = byAnchor.get(message.id)
    // A live assistant can keep appending items after this notice was emitted.
    // Keep those notices inside the card at explicit item boundaries;
    // ordinary notices still occupy their own transcript row after the message.
    const inline =
      message.role === 'assistant'
        ? after?.filter(
            (notice) => notice.systemNotice && (notice.withinMessage || isSystemActivity(notice)),
          )
        : undefined
    projected.push(inline?.length ? { ...message, inlineNotices: inline } : message)
    if (after) projected.push(...after.filter((notice) => !inline?.includes(notice)))
  }
  projected.push(...trailing)
  return {
    projected: groupSystemActivity(coalesceSystemMessages(projected)),
    identity: false,
    hasNotices: true,
  }
}

/**
 * Identity-memoized transcript projection with an O(delta) fast path for the
 * store's immutable append shape (`next = [...previous, ...delta]`), and a reuse path
 * for the streaming tail replacement. A transcript carrying notices still falls back to
 * a full projection whenever the change can REORDER rows — an append (whose anchors can
 * insert in the middle) or a tail with something anchored after it — because that
 * ordering is the whole reason the projection exists.
 */
export function createTranscriptProjectionSelector(
  onProject?: (metrics: TranscriptProjectionMetrics) => void,
): (messages: readonly Message[]) => readonly Message[] {
  let previousMessages: readonly Message[] | undefined
  let previousProjection: readonly Message[] | undefined
  let previousHasNotices = false
  let previousWasIdentity = false

  return (messages) => {
    if (messages === previousMessages && previousProjection) return previousProjection

    // Streaming replaces only the live tail message. For an unfiltered transcript
    // the raw store array already IS the exact projection, so this path is O(1)
    // even for a 100k-message session (no full scan and no 100k-element copy per
    // token delta).
    if (
      previousMessages &&
      previousProjection &&
      messages.length === previousMessages.length &&
      messages.length > 0 &&
      (messages.length === 1 ||
        messages[messages.length - 2] === previousMessages[previousMessages.length - 2])
    ) {
      const tail = messages[messages.length - 1]!
      if (!tail.isInternal && tail.role !== 'system' && !tail.continuedFromMessageId) {
        if (previousWasIdentity) {
          previousMessages = messages
          previousProjection = messages
          onProject?.({ mode: 'tail', messagesVisited: 1 })
          return messages
        }
        // Not identity — the transcript carries notices, so the projection is its own
        // array. It can still be reused if the streaming message is its LAST element:
        // then nothing is anchored after the tail and only that slot changed. This
        // matters because the identity path above switches OFF for the whole rest of a
        // session the first time the user changes model / agent / reasoning —
        // each of those paints a client-only notice — and every token delta then rebuilt
        // the full projection (Set + Map + rescan). This still copies the array (React
        // needs a new identity), so it is O(n) in pointers rather than O(1) — but it
        // drops the hashing and the rescan. Measured per delta on a synthetic transcript:
        // 5,000 messages 0.217 → 0.021 ms, 2,000 messages 0.095 → 0.009 ms.
        if (
          previousProjection[previousProjection.length - 1] ===
          previousMessages[previousMessages.length - 1]
        ) {
          const projected = [...previousProjection.slice(0, -1), tail]
          previousMessages = messages
          previousProjection = projected
          onProject?.({ mode: 'tail', messagesVisited: 1 })
          return projected
        }
      }
    }

    if (
      previousMessages &&
      previousProjection &&
      !previousHasNotices &&
      messages.length > previousMessages.length &&
      (previousMessages.length === 0 ||
        messages[previousMessages.length - 1] === previousMessages[previousMessages.length - 1])
    ) {
      const appended: Message[] = []
      let visited = 0
      let hasNotice = false
      for (let index = previousMessages.length; index < messages.length; index += 1) {
        visited += 1
        const message = messages[index]!
        if (message.isInternal) continue
        if (message.role === 'system' || message.continuedFromMessageId) {
          hasNotice = true
          break
        }
        appended.push(message)
      }

      if (!hasNotice) {
        const identity =
          previousWasIdentity && appended.length === messages.length - previousMessages.length
        const projected = identity
          ? messages
          : appended.length === 0
            ? previousProjection
            : [...previousProjection, ...appended]
        previousMessages = messages
        previousProjection = projected
        previousWasIdentity = identity
        onProject?.({ mode: 'append', messagesVisited: visited })
        return projected
      }
    }

    const { projected, identity, hasNotices } = buildTranscriptProjection(messages)
    previousMessages = messages
    previousProjection = projected
    previousWasIdentity = identity
    previousHasNotices = hasNotices
    onProject?.({ mode: 'full', messagesVisited: messages.length })
    return projected
  }
}
