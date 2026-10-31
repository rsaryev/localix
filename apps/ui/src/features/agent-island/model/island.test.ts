import { describe, expect, test } from 'bun:test'
import {
  initialIsland,
  ISLAND_TIMING,
  islandView,
  nextWake,
  reduceIsland,
  type IslandEvent,
  type IslandState,
} from './island'

/** Plays events one after another, so a test reads as what the person sees over time. */
function play(events: readonly IslandEvent[], from: IslandState = initialIsland()) {
  return events.reduce(reduceIsland, from)
}

const sync = (
  now: number,
  queue: readonly string[],
  extra: Partial<{ working: boolean; appFocused: boolean }> = {},
): IslandEvent => ({ type: 'sync', now, queue, working: false, appFocused: false, ...extra })

describe('the island over time', () => {
  test('it is hidden while nothing works or waits', () => {
    expect(islandView(initialIsland())).toEqual({ mode: 'hidden', open: false, key: null })
  })

  test('the notch light runs while an agent works, and there is nothing to open', () => {
    const state = play([sync(0, [], { working: true })])
    expect(islandView(state)).toEqual({ mode: 'working', open: false, key: null })
    // Hovering or clicking a working-only notch opens nothing: there is no chat here.
    const poked = play(
      [
        { type: 'pointer', inside: true, now: 10 },
        { type: 'tick', now: 10 + ISLAND_TIMING.hoverEnterMs },
        { type: 'activate', now: 20 },
      ],
      state,
    )
    expect(islandView(poked).open).toBe(false)
  })

  test('a request that arrives while Localix is in the background unfolds the card', () => {
    const state = play([sync(0, [], { working: true }), sync(5, ['ask-1'], { working: true })])
    expect(islandView(state)).toEqual({ mode: 'waiting', open: true, key: 'ask-1' })
  })

  test('a request that arrives while Localix is frontmost stays in the app', () => {
    const state = play([sync(0, ['ask-1'], { appFocused: true })])
    // No island at all: the app shows the request, and the notch stays dark.
    expect(islandView(state)).toEqual({ mode: 'hidden', open: false, key: null })
  })

  test('a request held back by the app unfolds when the person leaves Localix', () => {
    const state = play([sync(0, ['ask-1'], { appFocused: true }), sync(9, ['ask-1'])])
    expect(islandView(state)).toEqual({ mode: 'waiting', open: true, key: 'ask-1' })
  })

  test('returning to Localix folds the card and the app shows the request', () => {
    const open = play([sync(0, ['ask-1'])])
    const back = reduceIsland(open, sync(4, ['ask-1'], { appFocused: true }))
    expect(islandView(back)).toEqual({ mode: 'hidden', open: false, key: null })
    // Leaving again does not unfold a request that was already shown once.
    const away = reduceIsland(back, sync(8, ['ask-1']))
    expect(islandView(away)).toEqual({ mode: 'waiting', open: false, key: 'ask-1' })
  })

  test('an unanswered card folds after the hold, and the attention light stays', () => {
    const open = play([sync(0, ['ask-1'])])
    expect(nextWake(open)).toBe(ISLAND_TIMING.holdMs)
    const early = reduceIsland(open, { type: 'tick', now: ISLAND_TIMING.holdMs - 1 })
    expect(islandView(early).open).toBe(true)
    const folded = reduceIsland(early, { type: 'tick', now: ISLAND_TIMING.holdMs })
    expect(islandView(folded)).toEqual({ mode: 'waiting', open: false, key: 'ask-1' })
    expect(nextWake(folded)).toBeNull()
  })

  test('the hold waits while the pointer rests on the card', () => {
    const open = play([sync(0, ['ask-1']), { type: 'pointer', inside: true, now: 100 }])
    const later = reduceIsland(open, { type: 'tick', now: ISLAND_TIMING.holdMs * 4 })
    expect(islandView(later).open).toBe(true)
  })

  test('interacting with the card restarts the hold', () => {
    const open = play([sync(0, ['ask-1']), { type: 'engage', now: 10_000 }])
    expect(nextWake(open)).toBe(10_000 + ISLAND_TIMING.holdMs)
  })

  test('leaving the card with the pointer folds it, unless the person is answering', () => {
    const hovered = play([sync(0, ['ask-1']), { type: 'pointer', inside: true, now: 50 }])
    const left = reduceIsland(hovered, { type: 'pointer', inside: false, now: 100 })
    expect(nextWake(left)).toBe(100 + ISLAND_TIMING.hoverLeaveMs)
    const folded = reduceIsland(left, { type: 'tick', now: 100 + ISLAND_TIMING.hoverLeaveMs })
    expect(islandView(folded).open).toBe(false)

    const answering = play([
      sync(0, ['ask-1']),
      { type: 'pointer', inside: true, now: 50 },
      { type: 'engage', now: 60 },
      { type: 'pointer', inside: false, now: 100 },
      { type: 'tick', now: 100 + ISLAND_TIMING.hoverLeaveMs },
    ])
    expect(islandView(answering).open).toBe(true)
  })

  test('hover on the folded notch reopens it after the intent delay, and a click at once', () => {
    const folded = play([sync(0, ['ask-1']), { type: 'fold', now: 1 }])
    const hovering = reduceIsland(folded, { type: 'pointer', inside: true, now: 100 })
    expect(nextWake(hovering)).toBe(100 + ISLAND_TIMING.hoverEnterMs)
    const tooSoon = reduceIsland(hovering, {
      type: 'tick',
      now: 100 + ISLAND_TIMING.hoverEnterMs - 1,
    })
    expect(islandView(tooSoon).open).toBe(false)
    const opened = reduceIsland(tooSoon, { type: 'tick', now: 100 + ISLAND_TIMING.hoverEnterMs })
    expect(islandView(opened)).toEqual({ mode: 'waiting', open: true, key: 'ask-1' })

    const clicked = reduceIsland(folded, { type: 'activate', now: 5 })
    expect(islandView(clicked).open).toBe(true)
  })

  test('a pointer left over the notch after a fold must leave before hover reopens it', () => {
    const folded = play([
      sync(0, ['ask-1']),
      { type: 'pointer', inside: true, now: 10 },
      { type: 'fold', now: 20 },
      { type: 'tick', now: 20 + ISLAND_TIMING.hoverEnterMs * 3 },
    ])
    expect(islandView(folded).open).toBe(false)
    const again = play(
      [
        { type: 'pointer', inside: false, now: 2000 },
        { type: 'pointer', inside: true, now: 2100 },
        { type: 'tick', now: 2100 + ISLAND_TIMING.hoverEnterMs },
      ],
      folded,
    )
    expect(islandView(again).open).toBe(true)
  })

  test('folding by hand leaves the request pending and does not unfold it again by itself', () => {
    const state = play([sync(0, ['ask-1']), { type: 'fold', now: 3 }, sync(6, ['ask-1', 'ask-2'])])
    // ask-2 is new, so it unfolds; the ask-1 the person folded does not push itself back.
    expect(islandView(state)).toEqual({ mode: 'waiting', open: true, key: 'ask-2' })
    const quiet = play([sync(0, ['ask-1']), { type: 'fold', now: 3 }, sync(6, ['ask-1'])])
    expect(islandView(quiet)).toEqual({ mode: 'waiting', open: false, key: 'ask-1' })
  })
})

describe('answers', () => {
  test('answering the only request folds the island and it disappears', () => {
    const state = play([sync(0, ['ask-1']), sync(30, [])])
    expect(islandView(state)).toEqual({ mode: 'hidden', open: false, key: null })
  })

  test('with agents still working the notch goes back to its light', () => {
    const state = play([sync(0, ['ask-1'], { working: true }), sync(30, [], { working: true })])
    expect(islandView(state)).toEqual({ mode: 'working', open: false, key: null })
  })

  test('with several requests the next one takes the card', () => {
    const state = play([sync(0, ['ask-1', 'ask-2']), sync(30, ['ask-2'])])
    expect(islandView(state)).toEqual({ mode: 'waiting', open: true, key: 'ask-2' })
    // The next card starts its own hold, from the moment it appears.
    expect(nextWake(state)).toBe(30 + ISLAND_TIMING.holdMs)
  })

  test('a request answered elsewhere while folded clears the light', () => {
    const state = play([sync(0, ['ask-1']), { type: 'fold', now: 2 }, sync(9, [])])
    expect(islandView(state)).toEqual({ mode: 'hidden', open: false, key: null })
  })

  test('keyboard answers need the person to have clicked or typed in the card first', () => {
    const open = play([sync(0, ['ask-1'])])
    expect(open.engaged).toBe(false)
    expect(reduceIsland(open, { type: 'engage', now: 1 }).engaged).toBe(true)
    // A card that unfolded on its own never hands its next Enter to the request.
    expect(reduceIsland(open, { type: 'tick', now: 1 }).engaged).toBe(false)
  })
})
