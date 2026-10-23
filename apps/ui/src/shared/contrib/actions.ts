import { useSyncExternalStore } from 'react'
import type { ActionContext, ActionContribution } from '@localixai/mini-app-sdk/ui'
import { isMiniAppContributionEnabled, subscribeMiniAppActivation } from './miniAppActivation'

// Late plugin loading and activation must update already rendered content. First owner wins,
// as with comment actions: a collision must never change where a person's content is sent.
const entries = new Map<string, ActionContribution>()
const listeners = new Set<() => void>()
let snapshot: readonly ActionContribution[] | null = null

function announce() {
  snapshot = null
  for (const listener of listeners) listener()
}
subscribeMiniAppActivation(announce)

export function registerAction(action: ActionContribution): void {
  if (entries.get(action.id) === action) return
  if (entries.has(action.id)) {
    console.warn(`[ui-contrib] duplicate action "${action.id}" — keeping the first owner`)
    return
  }
  entries.set(action.id, action)
  announce()
}

export function removeActionsOf(owner: string): void {
  let changed = false
  for (const [id, action] of entries) {
    if (action.pluginName !== owner) continue
    entries.delete(id)
    changed = true
  }
  if (changed) announce()
}

export function contributedActions(): readonly ActionContribution[] {
  return (snapshot ??= [...entries.values()]
    .filter((action) => isMiniAppContributionEnabled(action.pluginName))
    .sort(
      (a, b) => (a.pluginName ?? '').localeCompare(b.pluginName ?? '') || a.id.localeCompare(b.id),
    ))
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useContributedActions() {
  return useSyncExternalStore(subscribe, contributedActions, contributedActions)
}

/** A faulty predicate must not take down the transcript; async predicates fail closed too. */
export function actionMatches(action: ActionContribution, context: ActionContext): boolean {
  try {
    const result = action.when(context) as unknown
    if (result instanceof Promise) void result.catch(() => {})
    return result === true
  } catch {
    return false
  }
}
