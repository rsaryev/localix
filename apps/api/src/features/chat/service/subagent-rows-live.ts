import type { SubagentRowsView } from './subagent-rows'

/** One drawing of a conversation's rows: the view, whether a row runs, and every row's id. */
export interface SubagentRowsComputed {
  view: SubagentRowsView
  running: boolean
  ids: readonly string[]
}

export interface Timers {
  set(run: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realTimers: Timers = {
  set(run, ms) {
    const handle = setTimeout(run, ms)
    handle.unref?.()
    return handle
  },
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** Claude Code batches status line updates this long, so a burst of changes runs it once. */
const DEBOUNCE_MS = 300
/** The refresh tick while a row runs: what keeps time-based fields (elapsed time) current. */
const TICK_MS = 2_000
/** Claude Code hands the command at most this many `tokenCount` readings per row. */
const MAX_SAMPLES = 16

export interface SubagentRowsLiveDeps {
  compute(
    userId: string,
    sessionId: string,
    samples: (taskId: string, tokens: number) => number[],
  ): Promise<SubagentRowsComputed>
  /** Is a client rendering any of these sessions right now? */
  watched(userId: string, ids: readonly string[]): boolean
  /** Poke the user's clients: the rows of one of their conversations changed. */
  publish(userId: string): void
  /** The parent and root of a session, to place a child the rows have not drawn yet. */
  locate(userId: string, sessionId: string): Promise<ReadonlyArray<string | null>>
  timers?: Timers
  tickMs?: number
  debounceMs?: number
}

interface Entry {
  userId: string
  sessionId: string
  view?: SubagentRowsView
  running: boolean
  ids: Set<string>
  samples: Map<string, number[]>
  timer: unknown
  /** What the armed timer is: a change's redraw, or the running rows' tick. */
  timerKind: 'change' | 'tick' | null
  computing: Promise<void> | null
  dirty: boolean
}

const sameView = (a: SubagentRowsView | undefined, b: SubagentRowsView) =>
  a !== undefined && JSON.stringify(a) === JSON.stringify(b)

/**
 * The rows a plugin's `subagentStatusLine` draws, kept per conversation on the server. Claude Code
 * runs the command on each refresh of its agent panel; here the server owns that refresh and the
 * clients are poked, then pull (P11):
 *
 * - a change to a row's inputs (a child born, its status, progress or tokens; a plugin enabled)
 *   runs the command once a short moment later, a burst of changes once, as Claude Code batches
 *   its status line updates;
 * - while a row runs and a client renders the conversation, a throttled tick re-runs it, so
 *   time-based fields stay current — it stops when nothing runs or nobody watches;
 * - the `subagent-rows` topic is poked only when the drawn rows differ from the last ones.
 *
 * A conversation nobody renders is dropped; the next read draws it afresh. One command runs per
 * conversation at a time: a change during a run reruns it once the run returns.
 */
export function createSubagentRowsLive(deps: SubagentRowsLiveDeps) {
  const timers = deps.timers ?? realTimers
  const tickMs = deps.tickMs ?? TICK_MS
  const debounceMs = deps.debounceMs ?? DEBOUNCE_MS
  const entries = new Map<string, Entry>()

  const clearTimer = (entry: Entry) => {
    if (entry.timer !== null) timers.clear(entry.timer)
    entry.timer = null
    entry.timerKind = null
  }

  const arm = (entry: Entry, kind: 'change' | 'tick') => {
    clearTimer(entry)
    entry.timerKind = kind
    entry.timer = timers.set(
      () => {
        entry.timer = null
        entry.timerKind = null
        void refresh(entry, true).catch(() => {})
      },
      kind === 'tick' ? tickMs : debounceMs,
    )
  }

  const forget = (entry: Entry) => {
    clearTimer(entry)
    entries.delete(entry.sessionId)
  }

  const sample =
    (entry: Entry, seen: Map<string, number[]>) => (taskId: string, tokens: number) => {
      const readings = [...(entry.samples.get(taskId) ?? []), tokens].slice(-MAX_SAMPLES)
      seen.set(taskId, readings)
      return readings
    }

  /**
   * Draw until no change arrived meanwhile. A redraw of its own (a change, a tick) drops a
   * conversation nobody renders any more; one a client just read keeps ticking until the next
   * tick, because its socket may declare the watch after its first read.
   */
  async function draw(entry: Entry, unprompted: boolean): Promise<void> {
    do {
      entry.dirty = false
      const seen = new Map<string, number[]>()
      const next = await deps.compute(entry.userId, entry.sessionId, sample(entry, seen))
      if (entries.get(entry.sessionId) !== entry) return
      const changed = entry.view !== undefined && !sameView(entry.view, next.view)
      entry.view = next.view
      entry.running = next.running
      entry.ids = new Set(next.ids)
      entry.samples = seen
      if (changed) deps.publish(entry.userId)
    } while (entry.dirty)
    if (unprompted && !deps.watched(entry.userId, [entry.sessionId, ...entry.ids])) forget(entry)
    else if (entry.view?.active && entry.running && entry.timer === null) arm(entry, 'tick')
  }

  function refresh(entry: Entry, unprompted: boolean): Promise<void> {
    if (entry.computing) {
      entry.dirty = true
      return entry.computing
    }
    entry.computing = draw(entry, unprompted).finally(() => {
      entry.computing = null
    })
    return entry.computing
  }

  /**
   * A change redraws a moment later, replacing a pending tick. Further changes in that moment ride
   * along rather than push it back, so a child that writes without pause still redraws.
   */
  const schedule = (entry: Entry) => {
    if (entry.timerKind !== 'change') arm(entry, 'change')
  }

  const entriesOf = (userId: string) =>
    [...entries.values()].filter((entry) => entry.userId === userId)

  return {
    /** The rows last drawn; the first read of a conversation draws them. */
    async read(userId: string, sessionId: string): Promise<SubagentRowsView> {
      let entry = entries.get(sessionId)
      if (!entry || entry.userId !== userId) {
        entry = {
          userId,
          sessionId,
          running: false,
          ids: new Set(),
          samples: new Map(),
          timer: null,
          timerKind: null,
          computing: null,
          dirty: false,
        }
        entries.set(sessionId, entry)
      }
      if (!entry.view) {
        const drawn = entry
        await (entry.computing ?? refresh(entry, false)).catch((error: unknown) => {
          if (!drawn.view) forget(drawn)
          throw error
        })
      }
      // A client reads again: a conversation that still runs is ticking for it.
      else if (entry.view.active && entry.running && entry.timer === null && !entry.computing)
        arm(entry, 'tick')
      return entry.view ?? { active: false, rows: [] }
    },

    /** A session or its messages changed: redraw the conversations that show it as a row. */
    async changed(userId: string, sessionId: string, opts: { locate?: boolean } = {}) {
      const mine = entriesOf(userId).filter((entry) => entry.view?.active)
      if (mine.length === 0) return
      const showing = mine.filter((entry) => entry.ids.has(sessionId))
      if (showing.length === 0 && opts.locate && !entries.has(sessionId)) {
        // A child the rows have not drawn yet (just born): place it by its parent and root.
        const around = (await deps.locate(userId, sessionId)).filter(Boolean) as string[]
        for (const entry of mine)
          if (around.some((id) => id === entry.sessionId || entry.ids.has(id))) showing.push(entry)
      }
      for (const entry of showing) schedule(entry)
    },

    /** A conversation was deleted: its rows go; a deleted row redraws the rows it was in. */
    deleted(userId: string, sessionId: string) {
      const own = entries.get(sessionId)
      if (own) forget(own)
      for (const entry of entriesOf(userId)) if (entry.ids.has(sessionId)) schedule(entry)
    },

    /** Redraw every kept conversation: a plugin moved, or the feed asks for a reconcile. */
    refreshAll() {
      for (const entry of entries.values()) schedule(entry)
    },

    /** Stop every timer (process stop, tests). */
    close() {
      for (const entry of entries.values()) forget(entry)
    },
  }
}

export type SubagentRowsLive = ReturnType<typeof createSubagentRowsLive>
