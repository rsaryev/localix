export interface ManifestLoadIssue {
  message: string
  detail?: string
}

export interface ManifestEditorState {
  targetKey: string
  original: string
  draft: string
  editing: boolean
  loading: boolean
  refreshing: boolean
  applying: boolean
  confirming: boolean
  loadIssue: ManifestLoadIssue | null
  applyError: string | null
  notice: string | null
}

export type ManifestEditorAction =
  | { type: 'targetChanged'; targetKey: string }
  | { type: 'loadStarted'; targetKey: string }
  | { type: 'loadSucceeded'; targetKey: string; yaml: string }
  | { type: 'loadFailed'; targetKey: string; issue: ManifestLoadIssue }
  | { type: 'startEditing' }
  | { type: 'draftChanged'; draft: string }
  | { type: 'reset' }
  | { type: 'cancelEditing' }
  | { type: 'requestApply' }
  | { type: 'cancelApply' }
  | { type: 'applyStarted' }
  | { type: 'applySucceeded'; yaml: string; notice: string }
  | { type: 'applyFailed'; error: string }

export function initialManifestEditorState(targetKey: string): ManifestEditorState {
  return {
    targetKey,
    original: '',
    draft: '',
    editing: false,
    loading: true,
    refreshing: false,
    applying: false,
    confirming: false,
    loadIssue: null,
    applyError: null,
    notice: null,
  }
}

export function manifestEditorDirty(state: ManifestEditorState): boolean {
  return state.editing && state.draft !== state.original
}

export function manifestEditorCanEdit(state: ManifestEditorState): boolean {
  return (
    Boolean(state.original) &&
    !state.editing &&
    !state.loading &&
    !state.refreshing &&
    !state.applying &&
    !state.loadIssue
  )
}

export function manifestEditorReducer(
  state: ManifestEditorState,
  action: ManifestEditorAction,
): ManifestEditorState {
  if (action.type === 'targetChanged') {
    return action.targetKey === state.targetKey
      ? state
      : initialManifestEditorState(action.targetKey)
  }
  if ('targetKey' in action && action.targetKey !== state.targetKey) return state

  switch (action.type) {
    case 'loadStarted':
      return {
        ...state,
        loading: !state.original,
        refreshing: Boolean(state.original),
        loadIssue: null,
      }
    case 'loadSucceeded':
      return {
        ...state,
        original: action.yaml,
        draft: state.editing ? state.draft : action.yaml,
        loading: false,
        refreshing: false,
        loadIssue: null,
      }
    case 'loadFailed':
      return {
        ...state,
        loading: false,
        refreshing: false,
        loadIssue: action.issue,
      }
    case 'startEditing':
      return manifestEditorCanEdit(state)
        ? { ...state, editing: true, applyError: null, notice: null }
        : state
    case 'draftChanged':
      return state.editing ? { ...state, draft: action.draft, applyError: null } : state
    case 'reset':
      return { ...state, draft: state.original, applyError: null }
    case 'cancelEditing':
      return {
        ...state,
        draft: state.original,
        editing: false,
        confirming: false,
        applyError: null,
      }
    case 'requestApply':
      return manifestEditorDirty(state) && !state.applying ? { ...state, confirming: true } : state
    case 'cancelApply':
      return { ...state, confirming: false }
    case 'applyStarted':
      return manifestEditorDirty(state) && !state.applying
        ? {
            ...state,
            confirming: false,
            applying: true,
            applyError: null,
            notice: null,
          }
        : state
    case 'applySucceeded':
      return {
        ...state,
        original: action.yaml,
        draft: action.yaml,
        editing: false,
        applying: false,
        applyError: null,
        notice: action.notice,
      }
    case 'applyFailed':
      return { ...state, applying: false, applyError: action.error }
  }
}
