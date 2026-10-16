import { useState } from 'react'
import { usePaneResize } from '@localixai/kit/pane-resize'

/** Storage key for the commit-log pane height (persists the user's split). */
const COMMITS_HEIGHT_KEY = 'sc_commits_height'

export type CommitsPaneResize = ReturnType<typeof usePaneResize>

export interface CommitsPane {
  /** Whether the commit-log pane is expanded. */
  commitsOpen: boolean
  setCommitsOpen: React.Dispatch<React.SetStateAction<boolean>>
  /** The pane's height and its sash handlers (pointer, keyboard, reset). */
  resize: CommitsPaneResize
}

/**
 * Collapsible commit-log pane anchored to the bottom of the panel: starts collapsed,
 * height persisted. The height is the kit's `usePaneResize` — this used to be a
 * hand-rolled pointer drag with no keyboard resize, no reset and no ARIA values,
 * i.e. a second copy of the sash every other workbench split already shares.
 */
export function useCommitsPane(): CommitsPane {
  const [commitsOpen, setCommitsOpen] = useState(false)
  const resize = usePaneResize({
    axis: 'y',
    // Anchored at the bottom: dragging UP grows it.
    direction: -1,
    initial: 220,
    min: 120,
    max: typeof window === 'undefined' ? 900 : Math.round(window.innerHeight * 0.75),
    storageKey: COMMITS_HEIGHT_KEY,
  })
  return { commitsOpen, setCommitsOpen, resize }
}
