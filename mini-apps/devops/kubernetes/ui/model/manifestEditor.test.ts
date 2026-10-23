import { describe, expect, test } from 'bun:test'
import {
  initialManifestEditorState,
  manifestEditorCanEdit,
  manifestEditorDirty,
  manifestEditorReducer,
  type ManifestEditorAction,
  type ManifestEditorState,
} from './manifestEditor'

const TARGET = 'local/apps/deployment/web'

function reduce(
  state: ManifestEditorState,
  ...actions: ManifestEditorAction[]
): ManifestEditorState {
  return actions.reduce(manifestEditorReducer, state)
}

function loaded(yaml = 'kind: Deployment'): ManifestEditorState {
  return reduce(initialManifestEditorState(TARGET), {
    type: 'loadSucceeded',
    targetKey: TARGET,
    yaml,
  })
}

describe('manifest editor state', () => {
  test('cannot enter edit mode before a manifest has loaded', () => {
    const initial = initialManifestEditorState(TARGET)

    expect(manifestEditorCanEdit(initial)).toBe(false)
    expect(manifestEditorReducer(initial, { type: 'startEditing' })).toBe(initial)
    expect(manifestEditorCanEdit(loaded())).toBe(true)
  })

  test('preserves a deliberate draft across a background refresh', () => {
    const state = reduce(
      loaded(),
      { type: 'startEditing' },
      { type: 'draftChanged', draft: 'kind: Deployment\nspec: edited' },
      { type: 'loadStarted', targetKey: TARGET },
      { type: 'loadSucceeded', targetKey: TARGET, yaml: 'kind: Deployment\nspec: remote' },
    )

    expect(state.original).toContain('spec: remote')
    expect(state.draft).toContain('spec: edited')
    expect(manifestEditorDirty(state)).toBe(true)
  })

  test('keeps the last good manifest visible when refresh fails', () => {
    const state = reduce(
      loaded(),
      { type: 'loadStarted', targetKey: TARGET },
      {
        type: 'loadFailed',
        targetKey: TARGET,
        issue: { message: 'Cluster timed out' },
      },
    )

    expect(state.original).toBe('kind: Deployment')
    expect(state.loading).toBe(false)
    expect(state.refreshing).toBe(false)
    expect(state.loadIssue?.message).toBe('Cluster timed out')
    expect(manifestEditorCanEdit(state)).toBe(false)
  })

  test('commits exactly the confirmed draft after a successful apply', () => {
    const state = reduce(
      loaded(),
      { type: 'startEditing' },
      { type: 'draftChanged', draft: 'kind: Deployment\nspec: confirmed' },
      { type: 'requestApply' },
      { type: 'applyStarted' },
      {
        type: 'applySucceeded',
        yaml: 'kind: Deployment\nspec: confirmed',
        notice: 'deployment.apps/web configured',
      },
    )

    expect(state).toMatchObject({
      original: 'kind: Deployment\nspec: confirmed',
      draft: 'kind: Deployment\nspec: confirmed',
      editing: false,
      applying: false,
      confirming: false,
      notice: 'deployment.apps/web configured',
    })
    expect(manifestEditorDirty(state)).toBe(false)
  })

  test('resets on a new target and ignores late responses from the old one', () => {
    const nextTarget = 'local/apps/deployment/api'
    const state = reduce(
      loaded(),
      { type: 'targetChanged', targetKey: nextTarget },
      { type: 'loadSucceeded', targetKey: TARGET, yaml: 'stale: true' },
    )

    expect(state).toEqual(initialManifestEditorState(nextTarget))
  })
})
