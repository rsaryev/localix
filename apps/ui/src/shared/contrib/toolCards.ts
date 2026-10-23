import { useSyncExternalStore } from 'react'
import type { ToolCardContribution } from '@localixai/mini-app-sdk/ui'

import { isPluginContributionEnabled, subscribePluginActivation } from './pluginActivation'

/**
 * How a plugin's own tools read in the transcript, keyed by the tool's name.
 *
 * The transcript's presentation table is keyed by CORE tool names, so a tool a plugin registered
 * rendered as the generic wrench — its name, raw IN/OUT — however much the plugin knew about it.
 * This is the open half of that table.
 *
 * A registration is not React state, and plugin UI chunks load after the transcript has painted:
 * a card that read this map at mount would keep the wrench for the rest of the session. So the
 * store carries a version ({@link useToolCardsVersion}) that the dispatcher subscribes to, and an
 * enable/disable moves it too.
 *
 * First registration wins. Two plugins claiming one tool name is a collision the host cannot
 * arbitrate, and swapping the card of calls already on screen would change what they show.
 */
const contributions = new Map<string, ToolCardContribution>()
const listeners = new Set<() => void>()
let version = 0

function announceToolCards(): void {
  version += 1
  for (const listener of listeners) listener()
}

// Enabling or disabling a plugin changes what `toolCardFor` answers without touching the map.
subscribePluginActivation(announceToolCards)

export function registerToolCard(contribution: ToolCardContribution): void {
  const existing = contributions.get(contribution.tool)
  if (existing === contribution) return
  if (existing) {
    console.warn(
      `[ui-contrib] duplicate tool card "${contribution.tool}" — keeping the first owner`,
    )
    return
  }
  contributions.set(contribution.tool, contribution)
  announceToolCards()
}

/** Drop every tool card `owner` registered (a plugin reload or unload). */
export function removeToolCardsOf(owner: string): void {
  let removed = false
  for (const [tool, contribution] of contributions) {
    if (contribution.pluginName !== owner) continue
    contributions.delete(tool)
    removed = true
  }
  if (removed) announceToolCards()
}

/** The contribution for `tool` while its plugin is enabled; a disabled plugin's tool is generic. */
export function toolCardFor(tool: string): ToolCardContribution | undefined {
  const contribution = contributions.get(tool)
  return contribution && isPluginContributionEnabled(contribution.pluginName)
    ? contribution
    : undefined
}

function subscribeToolCards(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function toolCardsVersion(): number {
  return version
}

/** Re-render when a tool card is registered, removed, or its plugin is toggled. */
export function useToolCardsVersion(): number {
  return useSyncExternalStore(subscribeToolCards, toolCardsVersion, toolCardsVersion)
}
