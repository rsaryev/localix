import { useSyncExternalStore } from 'react'
import type { CommentActionContribution } from '@localixai/mini-app-sdk/ui'

import { isMiniAppContributionEnabled, subscribeMiniAppActivation } from './miniAppActivation'

/**
 * What else a batch of review comments can become, beside "Send to the agent".
 *
 * The comment composer mounts before plugin UI chunks register, and a button row that read this
 * map at mount would never show a plugin's action. So the row subscribes
 * ({@link useCommentActions}), and enabling or disabling a plugin moves the same signal.
 *
 * First registration of an id wins: an id is plugin-chosen, and a second owner silently replacing
 * the first would send a person's comments somewhere they did not pick.
 */
const contributions = new Map<string, CommentActionContribution>()
const listeners = new Set<() => void>()
let version = 0
let snapshot: { version: number; actions: readonly CommentActionContribution[] } | null = null

function announceCommentActions(): void {
  version += 1
  for (const listener of listeners) listener()
}

subscribeMiniAppActivation(announceCommentActions)

export function registerCommentAction(contribution: CommentActionContribution): void {
  const existing = contributions.get(contribution.id)
  if (existing === contribution) return
  if (existing) {
    console.warn(
      `[ui-contrib] duplicate comment action "${contribution.id}" — keeping the first owner`,
    )
    return
  }
  contributions.set(contribution.id, contribution)
  announceCommentActions()
}

/** Drop every comment action `owner` registered (a plugin reload or unload). */
export function removeCommentActionsOf(owner: string): void {
  let removed = false
  for (const [id, contribution] of contributions) {
    if (contribution.pluginName !== owner) continue
    contributions.delete(id)
    removed = true
  }
  if (removed) announceCommentActions()
}

/**
 * Every enabled action, sorted by `(pluginName, id)` — identity, not a declared position, so no
 * plugin can claim the slot beside "Send" and the row does not reorder with load timing.
 */
export function commentActions(): readonly CommentActionContribution[] {
  if (snapshot?.version === version) return snapshot.actions
  const actions = [...contributions.values()]
    .filter((action) => isMiniAppContributionEnabled(action.pluginName))
    .sort(
      (a, b) => (a.pluginName ?? '').localeCompare(b.pluginName ?? '') || a.id.localeCompare(b.id),
    )
  snapshot = { version, actions }
  return actions
}

function subscribeCommentActions(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The enabled actions, re-read on every registration, removal or plugin toggle. */
export function useCommentActions(): readonly CommentActionContribution[] {
  return useSyncExternalStore(subscribeCommentActions, commentActions, commentActions)
}
