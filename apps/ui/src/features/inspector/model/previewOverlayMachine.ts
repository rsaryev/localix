export type PreviewOverlayKind = 'stopped' | 'unreachable' | 'blocked'

export interface PreviewOverlayState {
  explicitEngaged: boolean
  loadedFrame: string | null
  unreachableFrame: string | null
}

export type PreviewOverlayAction =
  | { type: 'engage' }
  | { type: 'frame-loaded'; frameKey: string }
  | { type: 'frame-timeout'; frameKey: string }

export const initialPreviewOverlayState: PreviewOverlayState = {
  explicitEngaged: false,
  loadedFrame: null,
  unreachableFrame: null,
}

export function previewOverlayReducer(
  state: PreviewOverlayState,
  action: PreviewOverlayAction,
): PreviewOverlayState {
  switch (action.type) {
    case 'engage':
      return state.explicitEngaged ? state : { ...state, explicitEngaged: true }
    case 'frame-loaded':
      if (state.loadedFrame === action.frameKey && state.unreachableFrame !== action.frameKey) {
        return state
      }
      return {
        ...state,
        loadedFrame: action.frameKey,
        unreachableFrame:
          state.unreachableFrame === action.frameKey ? null : state.unreachableFrame,
      }
    case 'frame-timeout':
      if (state.loadedFrame === action.frameKey || state.unreachableFrame === action.frameKey) {
        return state
      }
      return { ...state, unreachableFrame: action.frameKey }
  }
}

export function selectPreviewOverlayKind(input: {
  status: 'running' | 'stopped'
  frameBlocked: boolean
  engaged: boolean
  unreachable: boolean
}): PreviewOverlayKind | null {
  if (input.status === 'stopped') return 'stopped'
  if (input.frameBlocked && !input.engaged) return 'blocked'
  if (input.unreachable) return 'unreachable'
  return null
}
