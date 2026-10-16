/**
 * WHETHER A CARD HAS ANYTHING TO SHOW — two questions that look alike and are not.
 *
 * `messageIsEmpty` asks whether the card carries anything at all; an empty one renders nothing.
 * `messageHasVisibleBody` asks whether any of it can be SEEN yet. The backend seeds `items` with
 * an empty reasoning/text placeholder before the first token lands, so a live reply is not empty
 * while nothing on it is visible: gating the loading skeleton on emptiness skipped it and left a
 * blank row. `segments` are the continued parts of one utterance, and either answer covers them.
 */
import { isReasoningItem, isTextItem } from '@localixai/agent/agents/items'
import type { Message } from '../model/types'
import { isToolBacked } from './tool-parts/itemHelpers'

export function messageIsEmpty(message: Message, segments?: readonly Message[]): boolean {
  return (
    !segments?.some(
      (part) =>
        part.content ||
        part.reasoning ||
        part.items?.length ||
        part.bindings?.length ||
        part.inlineNotices?.length,
    ) &&
    !message.content &&
    !message.reasoning &&
    !message.items?.length &&
    !message.bindings?.length &&
    !message.inlineNotices?.length
  )
}

export function messageHasVisibleBody(message: Message, segments?: readonly Message[]): boolean {
  return Boolean(
    message.content ||
    segments?.some((part) => part.content || part.reasoning || part.items?.some(isToolBacked)) ||
    message.reasoning ||
    message.inlineNotices?.length ||
    message.bindings?.length ||
    (message.items ?? []).some(
      (it) => isToolBacked(it) || ((isTextItem(it) || isReasoningItem(it)) && it.text),
    ),
  )
}
