export type RailMenuState = { id: string; mode: 'hover' | 'press'; pressed: boolean } | null

export type RailMenuAction =
  | { type: 'hover'; id: string }
  | { type: 'press'; id: string; forceOpen?: boolean }
  | { type: 'leave' | 'dismiss'; id: string }

/** One open rail menu; persistent navigation follows the pointer across categories. */
export function transitionRailMenu(state: RailMenuState, action: RailMenuAction): RailMenuState {
  if (action.type === 'hover') {
    return state?.id === action.id
      ? state
      : { id: action.id, mode: state?.mode ?? 'hover', pressed: false }
  }
  if (action.type === 'press') {
    // The first press of a newly hovered category must keep it open, even during persistent navigation.
    return state?.id === action.id && state.pressed && !action.forceOpen
      ? null
      : { id: action.id, mode: 'press', pressed: true }
  }
  if (state?.id !== action.id || (action.type === 'leave' && state.mode === 'press')) return state
  return null
}
