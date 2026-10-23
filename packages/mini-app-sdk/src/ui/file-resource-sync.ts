import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createResourceSync, type ResourceSyncReader } from './resource-sync'
import { useMiniAppWorkspaceChanges } from './runtime-hooks'
import { runAsBackgroundWork, useVisiblePolling, useWorkItemVisible } from './visibility'

/** Conservative path matching includes a folder's creation/removal as well as its contents. */
export function workspacePathsTouch(paths: readonly string[] | null, prefix: string): boolean {
  if (paths === null) return true
  const segments = prefix.replace(/\\/gu, '/').split('/').filter(Boolean)
  if (!segments.length) return true
  return paths.some((path) => {
    const posix = `/${path.replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '')}`
    for (let length = 1; length <= segments.length; length++) {
      const marker = `/${segments.slice(0, length).join('/')}`
      const at = posix.indexOf(marker)
      if (at < 0) continue
      const end = at + marker.length
      if (
        length < segments.length ? end === posix.length : end === posix.length || posix[end] === '/'
      )
        return true
    }
    return false
  })
}

export interface FileResourceSyncOptions<T> extends ResourceSyncReader<T> {
  sessionId: string | null
  /** Project-relative directory, e.g. `.localix/resumes`. */
  prefix: string
  enabled?: boolean
  resetKey?: unknown
  windowMs?: number
  fallbackMs?: number
}

/**
 * File-backed read models use the host's socket/watcher and the same scheduler as core.
 * A healthy signal has no polling timer. Initial subscription, focus and returning to visibility
 * reconcile once; disconnected/unsupported watchers use a visibility-gated fallback.
 * Drafts, optimistic writes and conflict resolution belong to apply(), never this transport.
 */
export function useFileResourceSync<T>(options: FileResourceSyncOptions<T>) {
  const {
    sessionId,
    prefix,
    enabled = true,
    resetKey,
    windowMs = 250,
    fallbackMs = 15_000,
  } = options
  const latest = useRef(options)
  latest.current = options
  const itemVisible = useWorkItemVisible()
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === 'undefined' || !document.hidden,
  )
  const active = enabled && itemVisible && pageVisible && !!sessionId
  const { engine } = useMemo(
    () => ({ sessionId, resetKey, engine: createResourceSync<'snapshot'>() }),
    [sessionId, resetKey],
  )
  const refresh = useCallback(() => engine.refresh(['snapshot']), [engine])
  useEffect(() => {
    const current = () =>
      latest.current.sessionId === sessionId && latest.current.resetKey === resetKey
    return engine.register('snapshot', {
      read: (signal) => runAsBackgroundWork(() => latest.current.read(signal)),
      apply: (value) => {
        if (current()) latest.current.apply(value)
      },
      onError: (error) => {
        if (current()) latest.current.onError?.(error)
      },
    })
  }, [engine, sessionId, resetKey])
  useEffect(() => {
    if (active) engine.connected()
    else engine.disconnected()
    return () => engine.disconnected()
  }, [engine, active])
  useEffect(() => {
    const visible = () => setPageVisible(!document.hidden)
    const focus = () => {
      if (active) void refresh()
    }
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('focus', focus)
    return () => {
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('focus', focus)
    }
  }, [active, refresh])
  const live = useMiniAppWorkspaceChanges(
    sessionId,
    (change) => {
      if (workspacePathsTouch(change.paths, prefix)) engine.invalidate(['snapshot'])
    },
    { enabled: active, windowMs },
  )
  useVisiblePolling({ enabled: active && live !== true, intervalMs: fallbackMs, onTick: refresh })
  const supersede = useCallback(() => engine.invalidate(['snapshot'], false), [engine])
  return { refresh, live, supersede }
}
