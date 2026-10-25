import { RECAP_AFTER_MS } from '@localixai/api/session-recap'

/** Time as the trigger sees it: injected, so a test moves it by hand and never waits. */
export interface RecapClock {
  now(): number
  setTimeout(run: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

/** Whether the person is looking at this window, and when that changes. */
export interface RecapFocusSignal {
  isFocused(): boolean
  subscribe(listener: () => void): () => void
}

/** What the trigger needs to know about the conversation on screen. */
export interface RecapSessionState {
  sessionId: string | null
  running: boolean
  /** When the server last touched it (epoch ms): the guess for a chat opened already idle. */
  updatedAtMs: number | null
}

/**
 * Asks for a session recap once the person has been away long enough: the window is unfocused
 * and three minutes have passed since the on-screen chat's last turn finished. It asks once per
 * finished turn; the server still decides whether a recap is due (turns, never twice in a row,
 * the switch on the model picker row), so this only has to notice the break.
 */
export function createSessionRecapTrigger(deps: {
  clock: RecapClock
  focus: RecapFocusSignal
  request: (sessionId: string) => void
}) {
  const { clock, focus, request } = deps
  let state: { sessionId: string | null; running: boolean; settledAtMs: number | null } = {
    sessionId: null,
    running: false,
    settledAtMs: null,
  }
  /** The turn this window watched finish, per chat: the moment the break starts counting. */
  const settledAt = new Map<string, number>()
  const wasRunning = new Set<string>()
  let timer: unknown
  let armed = false
  /** The turn already asked about, so one turn is asked for once. */
  let asked: string | null = null

  const cancel = () => {
    if (armed) clock.clearTimeout(timer)
    armed = false
  }

  const schedule = () => {
    cancel()
    const { sessionId, running, settledAtMs } = state
    if (!sessionId || running || settledAtMs === null || focus.isFocused()) return
    const turn = `${sessionId}:${settledAtMs}`
    if (turn === asked) return
    const wait = Math.max(0, settledAtMs + RECAP_AFTER_MS - clock.now())
    armed = true
    timer = clock.setTimeout(() => {
      armed = false
      if (focus.isFocused()) return
      asked = turn
      request(sessionId)
    }, wait)
  }

  const unsubscribe = focus.subscribe(schedule)
  return {
    update(next: RecapSessionState) {
      const { sessionId } = next
      if (sessionId && next.running) wasRunning.add(sessionId)
      else if (sessionId && wasRunning.delete(sessionId)) settledAt.set(sessionId, clock.now())
      else if (sessionId && !settledAt.has(sessionId) && next.updatedAtMs !== null)
        settledAt.set(sessionId, next.updatedAtMs)
      state = {
        sessionId,
        running: next.running,
        settledAtMs: sessionId ? (settledAt.get(sessionId) ?? null) : null,
      }
      schedule()
    },
    dispose() {
      cancel()
      unsubscribe()
    },
  }
}
