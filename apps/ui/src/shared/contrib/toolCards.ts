import { useSyncExternalStore } from 'react'
import type { ToolCardContribution } from '@localixai/mini-app-sdk/ui'

import { isMiniAppContributionEnabled, subscribeMiniAppActivation } from './miniAppActivation'

/**
 * How a mini app's own tools read in the transcript, keyed by the tool's name.
 *
 * The transcript's presentation table is keyed by CORE tool names, so a tool a mini app registered
 * rendered as the generic wrench — its name, raw IN/OUT — however much the mini app knew about it.
 * This is the open half of that table.
 *
 * A registration is not React state, and mini app UI chunks load after the transcript has painted:
 * a card that read this map at mount would keep the wrench for the rest of the session. So the
 * store carries a version ({@link useToolCardsVersion}) that the dispatcher subscribes to, and an
 * enable/disable moves it too.
 *
 * First registration wins. Two mini apps claiming one tool name is a collision the host cannot
 * arbitrate, and swapping the card of calls already on screen would change what they show.
 */
const contributions = new Map<string, ToolCardContribution>()
const listeners = new Set<() => void>()
let version = 0

function announceToolCards(): void {
  version += 1
  for (const listener of listeners) listener()
}

// Enabling or disabling a mini app changes what `toolCardFor` answers without touching the map.
subscribeMiniAppActivation(announceToolCards)

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

/** Drop every tool card `owner` registered (a mini app reload or unload). */
export function removeToolCardsOf(owner: string): void {
  let removed = false
  for (const [tool, contribution] of contributions) {
    if (contribution.miniAppName !== owner) continue
    contributions.delete(tool)
    removed = true
  }
  if (removed) announceToolCards()
}

/**
 * The contribution for `tool` while its mini app is enabled; a disabled mini app's tool is generic.
 */
export function toolCardFor(tool: string): ToolCardContribution | undefined {
  const contribution = contributions.get(tool)
  return contribution && isMiniAppContributionEnabled(contribution.miniAppName)
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

/** Re-render when a tool card is registered, removed, or its mini app is toggled. */
export function useToolCardsVersion(): number {
  return useSyncExternalStore(subscribeToolCards, toolCardsVersion, toolCardsVersion)
}

/**
 * {@link toolCardFor} as a render reads it: the answer is the hook's value, read again on every
 * registration or toggle. A call beside {@link useToolCardsVersion} is not enough in the built app,
 * whose React Compiler keeps the call on its argument and so kept the generic card.
 */
export function useToolCardFor(tool: string): ToolCardContribution | undefined {
  const read = () => toolCardFor(tool)
  return useSyncExternalStore(subscribeToolCards, read, read)
}
