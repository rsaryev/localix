// Shared mediator for the inspector Activity work item: which chat message's
// tool outputs and sources the inspector mirrors. Lives in `shared` so the chat feature (the
// writers) and the inspector feature (the reader) stay decoupled — same-layer
// slices never import each other directly. Two writers: an explicit open (a
// message's "open in panel" action) and the chat scroll tracker (topmost
// tool-bearing message). The tab flips `active` on mount/unmount so the scroll
// tracker only does work while someone is looking at the panel.
import { create } from 'zustand'

export type MessageFocusSection = 'activity' | 'sources'

interface MessageFocusStore {
  /** The Activity work item is mounted — gates the chat scroll tracker. */
  active: boolean
  sessionId: string | null
  messageId: string | null
  /** When pinned, the scroll tracker stops re-pointing the focus (the tab freezes
   *  on the pinned message); explicit prev/next nav still writes `setFocus`. */
  pinned: boolean
  /** Monotonic tick: bumped to ask the chat transcript to scroll `messageId` into
   *  view (reverse-link "jump to message"). A counter, so repeat jumps re-fire. */
  revealSignal: number
  /** Explicit section requested by a message action. Ambient scroll tracking only changes focus. */
  section: MessageFocusSection
  /** Monotonic tick so clicking the same action twice still scrolls the panel to its section. */
  sectionSignal: number
  setActive: (active: boolean) => void
  setFocus: (sessionId: string, messageId: string) => void
  revealSection: (sessionId: string, messageId: string, section: MessageFocusSection) => void
  setPinned: (pinned: boolean) => void
  reveal: () => void
}

export const useMessageFocusStore = create<MessageFocusStore>((set) => ({
  active: false,
  sessionId: null,
  messageId: null,
  pinned: false,
  revealSignal: 0,
  section: 'activity',
  sectionSignal: 0,
  // Leaving the tab clears the pin so it never silently freezes a later visit.
  setActive: (active) => set(active ? { active: true } : { active: false, pinned: false }),
  setFocus: (sessionId, messageId) =>
    set((s) =>
      s.sessionId === sessionId && s.messageId === messageId ? s : { sessionId, messageId },
    ),
  revealSection: (sessionId, messageId, section) =>
    set((state) => ({
      sessionId,
      messageId,
      section,
      sectionSignal: state.sectionSignal + 1,
    })),
  setPinned: (pinned) => set({ pinned }),
  reveal: () => set((s) => ({ revealSignal: s.revealSignal + 1 })),
}))
