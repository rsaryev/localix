import { create } from 'zustand'
import type { TranscriptNavDir } from './transcriptNav'

/**
 * Tiny seam between the global "previous/next user prompt" commands (keybinding
 * + command palette) and the virtualized `MessageList` that owns the transcript
 * scroll. The command bumps `signal` with a direction; only the FOCUSED chat
 * surface's list reacts (it subscribes with `navActive`), so with multiple
 * surfaces mounted the active conversation is the one that scrolls.
 *
 * A monotonically-increasing `signal` (rather than just a direction) lets the
 * same direction fire repeatedly — each bump is a distinct navigation event.
 */
interface TranscriptNavState {
  signal: number
  dir: TranscriptNavDir
  jump: (dir: TranscriptNavDir) => void
}

export const useTranscriptNavStore = create<TranscriptNavState>((set) => ({
  signal: 0,
  dir: 'next',
  jump: (dir) => set((s) => ({ signal: s.signal + 1, dir })),
}))

/** Fire a prompt-navigation request (called from the global command handler). */
export function jumpToPrompt(dir: TranscriptNavDir): void {
  useTranscriptNavStore.getState().jump(dir)
}
