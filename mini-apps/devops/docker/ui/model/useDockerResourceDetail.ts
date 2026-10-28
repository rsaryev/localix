import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DockerApiError, dockerApi } from '../dockerApi'
import type { DevOpsIssue } from '../../../ui/DevOpsProblem'
import { dockerIssue } from './dockerIssue'
import {
  dockerResourceDetailMatches,
  dockerResourceFields,
  dockerResourceLabel,
  dockerResourceNeedsInitialLoad,
  type DockerResourceDetail,
} from './dockerResourceDetail'

interface DockerResourceState {
  targetKey: string
  detail: DockerResourceDetail | null
  loading: boolean
  error: DevOpsIssue | null
  /** The target whose load has begun (or that arrived seeded); '' while none has. */
  loadedTarget: string
}

export function useDockerResourceDetail({
  active,
  kind,
  identity,
  initial,
  fallbackLabel,
}: {
  active: boolean
  kind: DockerResourceDetail['kind']
  identity: string
  initial?: DockerResourceDetail
  fallbackLabel: string
}) {
  const targetKey = `${kind}/${identity}`
  const seededDetail = dockerResourceDetailMatches(initial, kind, identity) ? initial! : null
  const [state, setState] = useState<DockerResourceState>(() => ({
    targetKey,
    detail: seededDetail,
    loading: active && !seededDetail,
    error: null,
    loadedTarget: seededDetail ? targetKey : '',
  }))
  const refreshSeq = useRef(0)
  const targetState =
    state.targetKey === targetKey
      ? state
      : {
          targetKey,
          detail: seededDetail,
          loading: active && !seededDetail,
          error: null,
          loadedTarget: seededDetail ? targetKey : '',
        }
  const current = dockerResourceNeedsInitialLoad(
    active,
    targetState.loadedTarget,
    targetKey,
    targetState.detail,
  )
    ? { ...targetState, loading: true }
    : targetState

  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current
    setState((value) =>
      value.targetKey === targetKey
        ? { ...value, loading: true, error: null, loadedTarget: targetKey }
        : { targetKey, detail: seededDetail, loading: true, error: null, loadedTarget: targetKey },
    )
    try {
      let detail: DockerResourceDetail
      if (kind === 'image') {
        const resource = (await dockerApi.listImages()).find((row) => row.id === identity)
        if (!resource) throw new Error('Image no longer exists.')
        detail = { kind, resource }
      } else if (kind === 'volume') {
        const resource = (await dockerApi.listVolumes()).find((row) => row.name === identity)
        if (!resource) throw new Error('Volume no longer exists.')
        detail = { kind, resource }
      } else {
        const resource = (await dockerApi.listNetworks()).find((row) => row.id === identity)
        if (!resource) throw new Error('Network no longer exists.')
        detail = { kind, resource }
      }
      if (seq !== refreshSeq.current) return
      setState({ targetKey, detail, loading: false, error: null, loadedTarget: targetKey })
    } catch (cause) {
      if (seq !== refreshSeq.current) return
      const error =
        cause instanceof DockerApiError
          ? dockerIssue(cause)
          : { message: cause instanceof Error ? cause.message : 'Could not refresh this resource.' }
      setState((value) => ({
        targetKey,
        detail: value.targetKey === targetKey ? value.detail : seededDetail,
        loading: false,
        error,
        loadedTarget: targetKey,
      }))
    }
  }, [identity, kind, seededDetail, targetKey])

  // A read still in flight for the previous target must not land on this one.
  useEffect(() => {
    refreshSeq.current += 1
  }, [targetKey])

  // The first load of a shown target, started from a microtask so its loading flag and result are
  // set from the read's own callbacks, not while this effect runs.
  const loadedTarget = targetState.loadedTarget
  useEffect(() => {
    if (!active || loadedTarget === targetKey) return
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void refresh()
    })
    return () => {
      cancelled = true
    }
  }, [active, refresh, loadedTarget, targetKey])

  useEffect(
    () => () => {
      refreshSeq.current += 1
    },
    [],
  )

  return {
    detail: current.detail,
    loading: current.loading,
    error: current.error,
    label: current.detail ? dockerResourceLabel(current.detail) : fallbackLabel,
    fields: useMemo(
      () => (current.detail ? dockerResourceFields(current.detail) : []),
      [current.detail],
    ),
    refresh,
  }
}

export type DockerResourceDetailModel = ReturnType<typeof useDockerResourceDetail>
