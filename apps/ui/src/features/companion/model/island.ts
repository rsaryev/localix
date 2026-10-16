export interface IslandState {
  expanded: boolean
  focusComposer: boolean
  selectedKey: string | null
  /** Hover opens and focuses too, but only an interaction keeps it open after pointer exit. */
  preview: boolean
}

export type IslandEvent =
  | { type: 'toggle' }
  | { type: 'hover' }
  | { type: 'activate' }
  | { type: 'interact' }
  | { type: 'collapse' }
  | { type: 'back' }
  | { type: 'select'; key: string }
  | { type: 'resolved'; key: string }

export const RESTING_ISLAND: IslandState = {
  expanded: false,
  focusComposer: false,
  selectedKey: null,
  preview: false,
}

/** Folding the island never dismisses, answers, or snoozes a backend request. */
export function reduceIsland(state: IslandState, event: IslandEvent): IslandState {
  switch (event.type) {
    case 'toggle':
      return state.expanded
        ? RESTING_ISLAND
        : { expanded: true, focusComposer: true, selectedKey: null, preview: false }
    case 'activate':
      return { ...state, expanded: true, focusComposer: !state.selectedKey, preview: false }
    case 'interact':
      return state.preview ? { ...state, preview: false } : state
    case 'hover':
      return state.expanded
        ? state
        : { ...state, expanded: true, focusComposer: true, preview: true }
    case 'collapse':
      return RESTING_ISLAND
    case 'back':
      return { expanded: true, focusComposer: true, selectedKey: null, preview: false }
    case 'select':
      return { expanded: true, focusComposer: false, selectedKey: event.key, preview: false }
    case 'resolved':
      return state.selectedKey === event.key
        ? state.expanded
          ? { expanded: true, focusComposer: true, selectedKey: null, preview: false }
          : RESTING_ISLAND
        : state
  }
}
