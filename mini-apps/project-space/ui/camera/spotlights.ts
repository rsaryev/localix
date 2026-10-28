import type { RefObject } from 'react'

const SPOTLIGHT_MS = 1_600

/**
 * The glow on the board's nodes after the camera has taken someone to them: light a set of nodes
 * by id, and clear every glow and its timer when the board goes away. The board is read at the
 * moment of lighting, not when this is made, since its element exists only after the first commit.
 */
export interface Spotlights {
  readonly light: (ids: readonly string[]) => void
  readonly clear: () => void
}

export function createSpotlights(root: RefObject<HTMLElement | null>): Spotlights {
  const timers = new Map<HTMLElement, number>()
  return {
    light: (ids) => {
      const board = root.current
      if (!board || ids.length === 0) return
      for (const id of ids) {
        const node = board.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${CSS.escape(id)}"]`,
        )
        if (!node) continue
        // Off and on again, with a reflow between, so a second spotlight restarts the glow.
        node.classList.remove('space-spotlight')
        void node.offsetWidth
        node.classList.add('space-spotlight')
        const previous = timers.get(node)
        if (previous !== undefined) window.clearTimeout(previous)
        timers.set(
          node,
          window.setTimeout(() => {
            timers.delete(node)
            node.classList.remove('space-spotlight')
          }, SPOTLIGHT_MS),
        )
      }
    },
    clear: () => {
      for (const [node, timer] of timers) {
        window.clearTimeout(timer)
        node.classList.remove('space-spotlight')
      }
      timers.clear()
    },
  }
}
