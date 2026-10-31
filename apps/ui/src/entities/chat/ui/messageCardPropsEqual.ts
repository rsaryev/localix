import type { MessagePosition } from '../model/messageGroups'

/**
 * `memo` equality for `MessageCard`: identity for every prop, except the ones `MessageList` builds
 * fresh on every render — `position` (an object spread), `segmentWakeSources` (a `.map`) and a
 * continuation row's `segments` (regrouped whenever the transcript changes). With plain identity
 * they changed on every commit, so a streaming reply re-rendered every visible card on every frame,
 * not just the one being written. They are compared by value: the lists item by item.
 */
export function messageCardPropsEqual(
  prev: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
): boolean {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  for (const key of keys) {
    const a = prev[key]
    const b = next[key]
    if (a === b) continue
    if (key === 'position') {
      if (!samePosition(a as MessagePosition | undefined, b as MessagePosition | undefined))
        return false
      continue
    }
    if (key === 'segmentWakeSources' || key === 'segments') {
      if (!sameItems(a as readonly unknown[] | undefined, b as readonly unknown[] | undefined))
        return false
      continue
    }
    return false
  }
  return true
}

function samePosition(a: MessagePosition | undefined, b: MessagePosition | undefined): boolean {
  if (!a || !b) return a === b
  return (
    a.isFirstInGroup === b.isFirstInGroup &&
    a.isLastInGroup === b.isLastInGroup &&
    a.dayStart?.getTime() === b.dayStart?.getTime()
  )
}

function sameItems(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  if (!a || !b) return a === b
  return a.length === b.length && a.every((item, index) => item === b[index])
}
