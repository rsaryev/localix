import { stableStringify } from '@localixai/agent'
import type { backendClient } from '@/shared/api/client'
import type { UiSettingsPatch, AgentSettingsPatch } from '@/shared/api/contracts'
import type { UserSettings } from './userSettings'
import { currentAgentSettings } from './userSettings'

/**
 * THE PATCH ALGEBRA — pure translation between the store's settings shape and the profile wire.
 *
 * Separate from the store because none of it needs state, and because both halves encode the same
 * hard-won rule: a settings write is a TOP-LEVEL DELTA, never a blob. The legacy contract let
 * `agent_settings` be replaced wholesale, so one tab flushing its own copy destroyed every key
 * another tab or device had set. `subsettingDelta` is what keeps a write to one key a write to one
 * key — an absent key means "unchanged", and an explicit `null` means "cleared", which a
 * spread-the-whole-object patch cannot distinguish.
 */
type ProfileWirePatch = Parameters<typeof backendClient.updateUserProfile>[0]

/**
 * Fold a changed sub-settings object into the pending top-level delta: only keys whose value
 * actually moved, with a removal recorded as `null` rather than a hole.
 */
export function subsettingDelta(
  existing: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const delta = { ...existing }
  if (next === undefined) return delta
  const before = previous ?? {}
  for (const key of new Set([...Object.keys(before), ...Object.keys(next)])) {
    if (stableStringify(before[key]) === stableStringify(next[key])) continue
    delta[key] = next[key] === undefined ? null : next[key]
  }
  return delta
}

/**
 * Assemble the request body from whatever is pending. Returns an empty object when there is
 * nothing to send, which is the caller's signal to skip the request entirely.
 */
export function toProfileWirePatch(
  _pending: Partial<UserSettings>,
  uiSettingsPatch: UiSettingsPatch,
  agentSettingsPatch: AgentSettingsPatch,
): ProfileWirePatch {
  const apiPatch: ProfileWirePatch = {}
  if (Object.keys(uiSettingsPatch).length > 0) apiPatch.uiSettingsPatch = uiSettingsPatch
  if (Object.keys(agentSettingsPatch).length > 0) {
    let currentPatch = agentSettingsPatch
    const routes = agentSettingsPatch.modelRouting
    if (routes && typeof routes === 'object') {
      const modelRouting = currentAgentSettings({ modelRouting: routes }).modelRouting ?? {}
      currentPatch = { ...agentSettingsPatch, modelRouting }
      // A patch containing only retired routes is a no-op, not an instruction to clear
      // every current route on the server. An explicit empty object still clears them.
      if (Object.keys(routes).length > 0 && Object.keys(modelRouting).length === 0) {
        const { modelRouting: _retiredRoutes, ...rest } = currentPatch
        currentPatch = rest
      }
    }
    if (Object.keys(currentPatch).length > 0) apiPatch.agentSettingsPatch = currentPatch
  }
  return apiPatch
}

/** Adopt committed peer keys while keeping this window's edits and explicit removals. */
export function mergeSettingDelta<T extends object>(committed: T, visible: T, pending: object): T {
  const merged = { ...committed }
  for (const key of Object.keys(pending) as Array<keyof T>) {
    if (Object.hasOwn(visible, key)) merged[key] = visible[key]
    else delete merged[key]
  }
  return merged
}
