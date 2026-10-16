/**
 * THE PERSON'S OWN RECORD (`@human`), as each scope resolves it: project → installation → shipped.
 *
 * Read by the participants strip of every chat and edited from Settings → Agents, so it lives in
 * one small store keyed by scope. A save in any scope invalidates every scope, because a project
 * without its own override shows the installation's.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { HUMAN_HANDLE } from '@localixai/agent/agents'
import { backendClient } from '@/shared/api/client'
import type { AgentSummary } from '@/shared/api/contracts'

const cache = new Map<string, AgentSummary>()
const pending = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
let revision = 0

const emit = () => {
  revision += 1
  for (const listener of listeners) listener()
}

function load(scope: string): Promise<void> {
  const inFlight = pending.get(scope)
  if (inFlight) return inFlight
  const request = backendClient
    .getAgent(HUMAN_HANDLE, scope || null)
    .then((summary) => {
      cache.set(scope, summary)
      emit()
    })
    .catch(() => {})
    .finally(() => pending.delete(scope))
  pending.set(scope, request)
  return request
}

/** Drop every scope's copy and re-read the ones on screen. */
export function invalidateHumanProfiles(): void {
  const scopes = [...cache.keys()]
  cache.clear()
  emit()
  for (const scope of scopes) void load(scope)
}

/** The person's record for one scope ('' = installation); undefined until it has loaded. */
export function useHumanProfile(scope: string): AgentSummary | undefined {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => revision,
    () => revision,
  )
  useEffect(() => {
    if (!cache.has(scope)) void load(scope)
  }, [scope])
  return cache.get(scope)
}
