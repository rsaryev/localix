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
  }))
  const refreshSeq = useRef(0)
  const loadedTarget = useRef(seededDetail ? targetKey : '')
  const targetState =
    state.targetKey === targetKey
      ? state
      : {
          targetKey,
          detail: seededDetail,
          loading: active && !seededDetail,
          error: null,
        }
  const current = dockerResourceNeedsInitialLoad(
    active,
    loadedTarget.current,
    targetKey,
    targetState.detail,
  )
    ? { ...targetState, loading: true }
    : targetState

  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current
    setState((value) =>
      value.targetKey === targetKey
        ? { ...value, loading: true, error: null }
        : { targetKey, detail: seededDetail, loading: true, error: null },
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
      setState({ targetKey, detail, loading: false, error: null })
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
      }))
    }
  }, [identity, kind, seededDetail, targetKey])

  useEffect(() => {
    if (state.targetKey !== targetKey) {
      refreshSeq.current += 1
      loadedTarget.current = seededDetail ? targetKey : ''
      setState({
        targetKey,
        detail: seededDetail,
        loading: active && !seededDetail,
        error: null,
      })
    }
    if (!active || loadedTarget.current === targetKey) return
    loadedTarget.current = targetKey
    void refresh()
  }, [active, refresh, seededDetail, state.targetKey, targetKey])

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
