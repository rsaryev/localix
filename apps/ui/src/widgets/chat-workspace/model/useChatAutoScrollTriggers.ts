import { useEffect, useRef } from 'react'

import type { UiPendingHitlInteraction } from '@/shared/api/contracts'

export interface ChatAutoScrollTriggersDeps {
  pendingInteraction: UiPendingHitlInteraction | null
  scrollToBottom: (behavior?: ScrollBehavior) => void
  forceScrollToBottom: () => void
}

/**
 * Explicit auto-scroll triggers for the chat view. Opening/switching a session is handled by
 * `useAutoScroll`'s own open-at-bottom intent; only HITL changes move the transcript from here.
 *
 * The two calls are deliberately different strengths, which is the whole reason both exist:
 *
 *  - ARRIVAL uses the follow-PRESERVING `scrollToBottom`. The question itself renders as
 *    `interactionOverlay` inside the composer (`PromptInput`), so it is on screen whatever the scroll
 *    position — moving the transcript for it buys no visibility, and a reader deliberately up in
 *    history was being yanked to the tail for nothing.
 *  - RESOLUTION forces. The user has just acted, and the next generation streams from the bottom.
 */
export function useChatAutoScrollTriggers({
  pendingInteraction,
  scrollToBottom,
  forceScrollToBottom,
}: ChatAutoScrollTriggersDeps): void {
  // When a HITL interaction appears, scroll down so the user sees the question.
  // When it disappears (approve/dismiss), force-scroll to bottom so the next
  // generation run streams from the bottom regardless of where the user was.
  const prevInteractionRef = useRef<UiPendingHitlInteraction | null>(null)
  useEffect(() => {
    const prev = prevInteractionRef.current
    const curr = pendingInteraction
    prevInteractionRef.current = curr

    if (curr && !prev) {
      // Keep the tail in view for a reader who was already following; leave anyone else alone.
      scrollToBottom('smooth')
    } else if (!curr && prev) {
      // Interaction resolved — re-pin to bottom before generation resumes.
      forceScrollToBottom()
    }
  }, [pendingInteraction, scrollToBottom, forceScrollToBottom])
}
