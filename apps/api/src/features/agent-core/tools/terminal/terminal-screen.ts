import type { TerminalToolDeps } from './terminal'
import type { ScreenSnapshot } from './terminal-job'
import { watchTerminalActivity } from './terminal-activity'

export const QUIET_MS = 80

export interface ScreenRead {
  screen: ScreenSnapshot | null
  state: 'running' | 'exited' | 'unavailable'
}

export async function readScreen(deps: TerminalToolDeps, terminalId: string): Promise<ScreenRead> {
  const live = await deps.screen(terminalId)
  if (live) return { screen: live, state: 'running' }
  const final = (await deps.finalScreen?.(terminalId)) ?? null
  return { screen: final, state: final ? 'exited' : 'unavailable' }
}

export function renderScreen(s: ScreenSnapshot | null): string {
  if (!s) return '(screen unavailable; action="list" shows live terminals)'
  if (s.text.trim() === '') {
    return `screen ${s.cols}×${s.rows} is blank. Use wait_for to await expected text; avoid polling screen.`
  }
  return `screen ${s.cols}×${s.rows}, cursor at row ${s.cursor.row} col ${s.cursor.col}:\n${s.text}`
}

/** Render only on output, bounded by the quiet window and the overall cap. */
export async function settleScreen(
  deps: TerminalToolDeps,
  terminalId: string,
  opts: { maxMs: number; needNonEmpty?: boolean },
  signal?: AbortSignal,
): Promise<ScreenRead> {
  const capAt = Date.now() + opts.maxMs
  const activity = watchTerminalActivity(deps.watch, terminalId, signal)
  try {
    let last = await readScreen(deps, terminalId)
    for (;;) {
      if (last.state !== 'running') return last
      const blank = opts.needNonEmpty && !last.screen?.text.trim()
      const quietAt = blank ? capAt : Math.min(capAt, Date.now() + QUIET_MS)
      const wake = await activity.next(quietAt)
      if (wake === 'aborted' || wake === 'deadline') return last
      last = await readScreen(deps, terminalId)
      if (wake === 'exit') return { ...last, state: 'exited' }
      // Even a cursor-only redraw is activity. It must not certify quiet output.
    }
  } finally {
    activity.close()
  }
}
