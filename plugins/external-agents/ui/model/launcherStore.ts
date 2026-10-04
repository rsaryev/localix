/**
 * ONE reading of "which agent CLIs are installed", shared by every surface that asks.
 *
 * A module store rather than a hook-local `useState`, because of what the consumer is: a titlebar
 * status item. `StatusItemContribution.useItem` runs on EVERY render of the chrome, for every
 * session, forever — the contract's own words are "nothing per RENDER". A per-hook fetch would put
 * a PATH scan behind a bar that redraws whenever anything else in it changes; a subscription to one
 * store costs a `useSyncExternalStore` and nothing else.
 *
 * The load is kicked off from an EFFECT, never from the render that reads the snapshot: a store
 * write during render is what React #185 is made of.
 */
import { useEffect, useSyncExternalStore } from 'react'

import { ExternalAgentsApiError, externalAgentsApi } from '../api/externalAgentsApi'
import type { AgentCliStatus } from './types'

export interface LauncherState {
  /** `idle` is "nobody has asked yet" — distinct from `loading`, which is a spinner. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  /** EVERY launcher with its verdict. Surfaces filter; the store does not decide for them. */
  readonly launchers: readonly AgentCliStatus[]
  readonly error: string | null
  /** The raw text behind `error`. Event Center only, never on a menu line. */
  readonly errorDetail: string | null
}

const EMPTY: readonly AgentCliStatus[] = []

let state: LauncherState = { status: 'idle', launchers: EMPTY, error: null, errorDetail: null }
const listeners = new Set<() => void>()
let inFlight: Promise<void> | null = null

function publish(next: LauncherState): void {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Load once, or again on demand.
 *
 * Concurrent callers share the in-flight promise, so three surfaces mounting together make one
 * request. A `refresh` is allowed to join an in-flight refresh but never an in-flight cached read —
 * that is what would make "Check again" return the answer it was pressed to replace.
 */
export function loadAgentLaunchers(options?: { refresh?: boolean }): void {
  const refresh = options?.refresh === true
  if (inFlight && !refresh) return
  if (!refresh && state.status === 'ready') return

  publish({ ...state, status: 'loading' })
  const request = externalAgentsApi
    .launchers(refresh)
    .then((launchers) => {
      publish({ status: 'ready', launchers, error: null, errorDetail: null })
    })
    .catch((cause: unknown) => {
      publish({
        // The previous reading is KEPT on failure. A transient error must not empty a menu that
        // was correct a second ago — the line says the check failed, the launchers still work.
        status: 'error',
        launchers: state.launchers,
        error:
          cause instanceof Error ? cause.message : 'Could not check for installed agent CLIs here.',
        errorDetail: cause instanceof ExternalAgentsApiError ? (cause.detail ?? null) : null,
      })
    })
    .finally(() => {
      if (inFlight === request) inFlight = null
    })
  inFlight = request
}

/** Manual re-check — the menu entry someone presses after installing a CLI. */
export function refreshAgentLaunchers(): void {
  loadAgentLaunchers({ refresh: true })
}

/** Test seam: forget everything this process learned. */
export function __resetAgentLaunchers(): void {
  inFlight = null
  publish({ status: 'idle', launchers: EMPTY, error: null, errorDetail: null })
}

function snapshot(): LauncherState {
  return state
}

export function useAgentLaunchers(): LauncherState {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    loadAgentLaunchers()
  }, [])
  return current
}
