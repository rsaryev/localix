import type { CameraCommand, CameraMove, CameraReport } from '../shared/camera'

/**
 * Where a camera move waits for the tab, and the tab's report waits for the tool — per chat,
 * because each chat's tab has its own camera.
 *
 * A camera that answers the agent seconds later is no camera, so the open tab follows the chat's
 * moves on the realtime socket (`ws-frames.ts`) and each one is pushed the moment it is sent. It
 * used to hold an HTTP request open for the next move and re-issue it after every answer and
 * every 20 s of silence. The last move is kept for a short while, so a tab the same call just
 * opened (or one whose socket just came back) still gets it when it starts following; an older
 * one is stale and dropped — a board opened tomorrow must not jump to where the agent looked
 * today. The tool then waits for the report of THAT move (by its sequence number), so what it
 * tells the agent is what the person now sees.
 */
const KEEP_MS = 15_000

interface Chat {
  seq: number
  last?: { command: CameraCommand; at: number }
  followers: Set<(command: CameraCommand) => void>
  reports: Map<number, CameraReport>
  reportWaiters: Map<number, (report: CameraReport) => void>
}

const chats = new Map<string, Chat>()

function chat(sessionId: string): Chat {
  let found = chats.get(sessionId)
  if (!found) {
    found = { seq: 0, followers: new Set(), reports: new Map(), reportWaiters: new Map() }
    chats.set(sessionId, found)
  }
  return found
}

export const cameraHub = {
  /** Send a move to the chat's tab; answers its sequence number. */
  send(sessionId: string, move: CameraMove): number {
    const state = chat(sessionId)
    const command = { seq: ++state.seq, move }
    state.last = { command, at: Date.now() }
    for (const deliver of Array.from(state.followers)) deliver(command)
    return command.seq
  },

  /** Whether a tab of this chat is following its moves right now. */
  listening(sessionId: string): boolean {
    return (chats.get(sessionId)?.followers.size ?? 0) > 0
  },

  /**
   * Follow the chat's moves: the last one at once when it is still fresh, then each as it is
   * sent. The tab skips a move it already took by its sequence number.
   */
  follow(sessionId: string, deliver: (command: CameraCommand) => void): () => void {
    const state = chat(sessionId)
    const last = state.last
    if (last && Date.now() - last.at < KEEP_MS) deliver(last.command)
    state.followers.add(deliver)
    return () => {
      state.followers.delete(deliver)
    }
  },

  report(sessionId: string, report: CameraReport): void {
    const state = chat(sessionId)
    const waiting = state.reportWaiters.get(report.seq)
    if (waiting) {
      state.reportWaiters.delete(report.seq)
      waiting(report)
      return
    }
    state.reports.set(report.seq, report)
    // Only the latest few matter; a report nobody waits for is kept briefly for a slow tool.
    for (const seq of state.reports.keys()) if (seq < report.seq - 4) state.reports.delete(seq)
  },

  /** The report of move `seq`, or null when the tab did not answer in time. */
  awaitReport(sessionId: string, seq: number, timeoutMs: number): Promise<CameraReport | null> {
    const state = chat(sessionId)
    const ready = state.reports.get(seq)
    if (ready) return Promise.resolve(ready)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        state.reportWaiters.delete(seq)
        resolve(null)
      }, timeoutMs)
      state.reportWaiters.set(seq, (report) => {
        clearTimeout(timer)
        resolve(report)
      })
    })
  },
}
