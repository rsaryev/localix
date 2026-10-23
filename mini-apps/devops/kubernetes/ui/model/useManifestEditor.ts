import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { KubeManifestKind } from '../../backend/contracts'
import { kubernetesApi } from '../api/kubernetesApi'
import { KubeApiError } from '../api/transport'
import {
  initialManifestEditorState,
  manifestEditorCanEdit,
  manifestEditorDirty,
  manifestEditorReducer,
} from './manifestEditor'

export function useManifestEditor({
  kind,
  name,
  namespace,
  context,
}: {
  kind: KubeManifestKind
  name: string
  namespace: string
  context?: string
}) {
  const ctx = context || undefined
  const targetKey = `${ctx ?? ''}/${namespace}/${kind}/${name}`
  const [state, dispatch] = useReducer(manifestEditorReducer, targetKey, initialManifestEditorState)
  const loadSeq = useRef(0)
  const applySeq = useRef(0)
  const applyingSeq = useRef<number | null>(null)
  const pendingLoad = useRef<{
    key: string
    promise: ReturnType<typeof kubernetesApi.getManifest>
  } | null>(null)
  const currentState = state.targetKey === targetKey ? state : initialManifestEditorState(targetKey)

  const load = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      const seq = ++loadSeq.current
      dispatch({ type: 'loadStarted', targetKey })
      const active = pendingLoad.current
      const promise =
        !force && active?.key === targetKey
          ? active.promise
          : kubernetesApi.getManifest(kind, name, namespace, ctx)
      if (promise !== active?.promise) pendingLoad.current = { key: targetKey, promise }

      try {
        const manifest = await promise
        if (seq !== loadSeq.current) return
        dispatch({ type: 'loadSucceeded', targetKey, yaml: manifest.yaml })
      } catch (cause) {
        if (seq !== loadSeq.current) return
        dispatch({
          type: 'loadFailed',
          targetKey,
          issue:
            cause instanceof KubeApiError
              ? { message: cause.message, detail: cause.detail }
              : { message: 'Could not load the manifest.' },
        })
      } finally {
        if (pendingLoad.current?.promise === promise) pendingLoad.current = null
      }
    },
    [ctx, kind, name, namespace, targetKey],
  )

  useEffect(() => {
    dispatch({ type: 'targetChanged', targetKey })
    void load()
    return () => {
      loadSeq.current += 1
      applySeq.current += 1
    }
  }, [load, targetKey])

  const apply = useCallback(async () => {
    if (
      applyingSeq.current !== null ||
      !currentState.confirming ||
      !manifestEditorDirty(currentState)
    ) {
      return
    }
    const seq = ++applySeq.current
    applyingSeq.current = seq
    const yaml = currentState.draft
    dispatch({ type: 'applyStarted' })
    try {
      const result = await kubernetesApi.applyManifest(yaml, ctx)
      if (seq !== applySeq.current) return
      dispatch({
        type: 'applySucceeded',
        yaml,
        notice: result.output || 'Applied.',
      })
      // A mutation must never join a pre-apply read that may still be in flight.
      await load({ force: true })
    } catch (cause) {
      if (seq !== applySeq.current) return
      dispatch({
        type: 'applyFailed',
        error:
          cause instanceof KubeApiError
            ? cause.detail?.trim() || cause.message
            : 'Could not apply the manifest.',
      })
    } finally {
      if (applyingSeq.current === seq) applyingSeq.current = null
    }
  }, [ctx, currentState, load])

  return {
    ...currentState,
    dirty: manifestEditorDirty(currentState),
    canEdit: manifestEditorCanEdit(currentState),
    canRefresh: !currentState.loading && !currentState.refreshing && !currentState.applying,
    refresh: load,
    startEditing: () => dispatch({ type: 'startEditing' }),
    setDraft: (draft: string) => dispatch({ type: 'draftChanged', draft }),
    reset: () => dispatch({ type: 'reset' }),
    cancelEditing: () => dispatch({ type: 'cancelEditing' }),
    requestApply: () => dispatch({ type: 'requestApply' }),
    cancelApply: () => dispatch({ type: 'cancelApply' }),
    apply,
  }
}

export type ManifestEditorModel = ReturnType<typeof useManifestEditor>
