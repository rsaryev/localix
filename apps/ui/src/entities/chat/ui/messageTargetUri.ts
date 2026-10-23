/**
 * WHICH MESSAGE AN OUTSIDE ADDRESS NAMES: a `localix://` resource URI, or an Event Center request.
 *
 * Pure, and apart from the list that scrolls to the answer, so the rules can be checked without
 * mounting a virtualizer — each of them is a place where a wrong answer either throws inside
 * render or lets a hidden transcript swallow a jump meant for the visible one.
 */
import { localixResourceUri } from '@localixai/mini-app-sdk/navigation'
import type { EventFocusRequest } from '@/shared/lib/eventFocusBus'
import type { Message } from '../model/types'

/**
 * The addressable URI for one message row, or `undefined` when there is nothing to address.
 *
 * `sessionId` is nullable and every OTHER use in the list guards it. This one used
 * `sessionId ?? ''`, which silences the type checker with a value the runtime rejects:
 * `localixResourceUri` throws on an empty segment, from inside render, where the only net was the
 * ROOT error boundary — the same shape that took the whole workspace down when a mini app did it.
 *
 * A message with no session simply is not addressable, and `useUiTarget` already accepts
 * `undefined` and registers nothing. Saying that is both truthful and unable to throw.
 */
export function messageTargetUri(sessionId: string | null, messageId: string): string | undefined {
  if (!sessionId || !messageId) return undefined
  return localixResourceUri('chat', ['message', sessionId, messageId])
}

/** Feature-owned resolver for generic Event Center focus requests. */
export function eventFocusMessageId(
  messages: readonly Message[],
  request: EventFocusRequest,
): string | null {
  if (request.resourceKind === 'run') {
    return messages.some((message) => message.id === request.resourceId) ? request.resourceId : null
  }
  if (request.resourceKind !== 'tool' && request.resourceKind !== 'interaction') return null
  return (
    messages.find((message) =>
      (message.items ?? []).some(
        (item) =>
          'toolCallId' in item &&
          typeof item.toolCallId === 'string' &&
          item.toolCallId.startsWith(request.resourceId),
      ),
    )?.id ?? null
  )
}

/** A warm hidden transcript may observe the request, but only the visible owner may claim it. */
export function visibleEventFocusRequest(
  request: EventFocusRequest | null,
  sessionId: string | null,
  workItemVisible: boolean,
): EventFocusRequest | null {
  return workItemVisible && request?.sessionId === sessionId ? request : null
}
