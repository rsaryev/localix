import type { RunTurnState } from './turn-state'

/**
 * Book a finished tool call: its own compute time, with every human wait it contained taken
 * out and booked as HITL — the wait a tool IS (`ask`, still open at tool end) and the wait that
 * preceded it (a permission card, closed before the tool ran). Without the second kind a 12s
 * `find` behind a 4-minute approval card read as a 233s tool.
 */
export function settleToolTiming(
  state: RunTurnState,
  toolCallId: string,
  toolName: string,
  endedAt: number,
): void {
  const toolStart = state.toolStartTimes.get(toolCallId)
  state.toolStartTimes.delete(toolCallId)
  const hitlStart = state.hitlStartTimes.get(toolCallId)
  state.hitlStartTimes.delete(toolCallId)
  const hitlWaited = state.hitlWaitedMs.get(toolCallId) ?? 0
  state.hitlWaitedMs.delete(toolCallId)
  if (toolStart === undefined) return
  const hitlWait = (hitlStart !== undefined ? Math.max(0, endedAt - hitlStart) : 0) + hitlWaited
  state.timing.hitlMs += hitlWait
  const durationMs = Math.max(0, endedAt - toolStart - hitlWait)
  state.timing.toolMs += durationMs
  state.timing.tools.push({ toolCallId, toolName, durationMs })
}
