/**
 * What the island shows, as one pure reducer. Time comes in with every event, so nothing here
 * reads a clock or sleeps; `useIsland` turns pointer, focus and native events into these events and
 * schedules the next wake-up from `nextWake`.
 *
 * The island has no chat. It exists only for a request that blocks a run, and for the light that
 * runs while agents work:
 *
 *   hidden      nothing works or waits: nothing is drawn and every click passes through
 *   working     the notch light runs; there is nothing to open
 *   unfolded    a request waits and Localix is in the background: its card is open
 *   folded      the request went unanswered, or the pointer left: the notch keeps a warm light, and
 *               hover or a click reopens the card
 *
 * An answer, an expiry, a cancel or an answer given in the app drops the request from the queue,
 * which shows the next one or folds the island away. Folding is never an answer.
 */

/** Intent thresholds. Hover must be deliberate; leaving must survive a diagonal pointer path. */
export const ISLAND_TIMING = { hoverEnterMs: 400, hoverLeaveMs: 450, holdMs: 15_000 } as const

export interface IslandState {
  /** Pending request keys, the one to answer first at the head. */
  queue: readonly string[]
  /** Any agent is running. */
  working: boolean
  /** A Localix workspace is the focused window: the app shows requests itself. */
  appFocused: boolean
  open: boolean
  /** The request in the open card; null while folded. */
  key: string | null
  /** Requests the island already unfolded for. A fold keeps them quiet until hover or a click. */
  announced: ReadonlySet<string>
  pointerInside: boolean
  pointerSince: number | null
  /** A pointer left resting over the notch after a fold must leave before hover reopens it. */
  hoverBlocked: boolean
  /** The person clicked or typed in this card: only then may Enter and Escape answer it. */
  engaged: boolean
  /** The last time the card opened or was used; the hold counts from here. */
  activityAt: number
  /** When the pointer left an unengaged card. */
  leftAt: number | null
}

export type IslandEvent =
  | {
      type: 'sync'
      now: number
      queue: readonly string[]
      working: boolean
      appFocused: boolean
    }
  | { type: 'pointer'; now: number; inside: boolean }
  /** A click on the notch, or a native first click. */
  | { type: 'activate'; now: number }
  /** A click, a key or an input inside the card. */
  | { type: 'engage'; now: number }
  /** Outside click, the panel losing focus, or the host folding it. */
  | { type: 'fold'; now: number }
  | { type: 'tick'; now: number }

export interface IslandView {
  mode: 'hidden' | 'working' | 'waiting'
  open: boolean
  /** The request to show (open, or ready behind the folded notch); null when nothing waits. */
  key: string | null
}

export function initialIsland(): IslandState {
  return {
    queue: [],
    working: false,
    appFocused: false,
    open: false,
    key: null,
    announced: new Set(),
    pointerInside: false,
    pointerSince: null,
    hoverBlocked: false,
    engaged: false,
    activityAt: 0,
    leftAt: null,
  }
}

const waiting = (state: IslandState) => state.queue.length > 0 && !state.appFocused

export function islandView(state: IslandState): IslandView {
  if (waiting(state)) {
    return { mode: 'waiting', open: state.open, key: state.key ?? state.queue[0] ?? null }
  }
  return { mode: state.working ? 'working' : 'hidden', open: false, key: null }
}

function unfold(state: IslandState, key: string, now: number, engaged: boolean): IslandState {
  return {
    ...state,
    open: true,
    key,
    announced: new Set([...state.announced, key]),
    engaged,
    activityAt: now,
    leftAt: null,
  }
}

function fold(state: IslandState): IslandState {
  return {
    ...state,
    open: false,
    key: null,
    engaged: false,
    leftAt: null,
    hoverBlocked: state.pointerInside,
  }
}

function sync(state: IslandState, event: Extract<IslandEvent, { type: 'sync' }>): IslandState {
  const { now, queue, working, appFocused } = event
  const live = new Set(queue)
  const announced = new Set([...state.announced].filter((key) => live.has(key)))
  let next: IslandState = { ...state, queue, working, appFocused, announced }
  if (appFocused) return next.open ? fold(next) : { ...next, key: null }
  if (next.open && next.key !== null && !live.has(next.key)) {
    // Answered, expired or settled elsewhere: the next request takes the card, else it folds away.
    const following = queue[0]
    return following === undefined ? fold(next) : unfold(next, following, now, false)
  }
  if (!next.open) {
    if (next.key !== null && !live.has(next.key)) next = { ...next, key: null }
    // A request the island has not shown yet unfolds it; a folded one stays folded.
    const fresh = queue.find((key) => !announced.has(key))
    if (fresh !== undefined) return unfold(next, fresh, now, false)
  }
  return next
}

export function reduceIsland(state: IslandState, event: IslandEvent): IslandState {
  switch (event.type) {
    case 'sync':
      return sync(state, event)
    case 'pointer':
      if (event.inside) {
        return state.pointerInside
          ? state
          : { ...state, pointerInside: true, pointerSince: event.now, leftAt: null }
      }
      return {
        ...state,
        pointerInside: false,
        pointerSince: null,
        hoverBlocked: false,
        leftAt: state.open && !state.engaged ? event.now : null,
      }
    case 'activate': {
      if (state.open) return { ...state, engaged: true, activityAt: event.now }
      const head = state.key ?? state.queue[0]
      return waiting(state) && head !== undefined ? unfold(state, head, event.now, true) : state
    }
    case 'engage':
      return state.open ? { ...state, engaged: true, activityAt: event.now, leftAt: null } : state
    case 'fold':
      return state.open ? fold(state) : state
    case 'tick': {
      if (state.open) {
        const left = state.leftAt !== null && !state.engaged
        if (left && event.now - state.leftAt! >= ISLAND_TIMING.hoverLeaveMs) return fold(state)
        if (!state.pointerInside && event.now - state.activityAt >= ISLAND_TIMING.holdMs) {
          return fold(state)
        }
        return state
      }
      const head = state.queue[0]
      if (
        head !== undefined &&
        waiting(state) &&
        state.pointerInside &&
        !state.hoverBlocked &&
        state.pointerSince !== null &&
        event.now - state.pointerSince >= ISLAND_TIMING.hoverEnterMs
      ) {
        return unfold(state, head, event.now, false)
      }
      return state
    }
  }
}

/** The time the next `tick` should run, or null when nothing is waiting on a timer. */
export function nextWake(state: IslandState): number | null {
  if (state.open) {
    const wakes: number[] = []
    if (state.leftAt !== null && !state.engaged)
      wakes.push(state.leftAt + ISLAND_TIMING.hoverLeaveMs)
    if (!state.pointerInside) wakes.push(state.activityAt + ISLAND_TIMING.holdMs)
    return wakes.length ? Math.min(...wakes) : null
  }
  if (waiting(state) && state.pointerInside && !state.hoverBlocked && state.pointerSince !== null) {
    return state.pointerSince + ISLAND_TIMING.hoverEnterMs
  }
  return null
}
