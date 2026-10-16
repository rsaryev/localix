/** Run clocks live outside the composer: changing tabs must not restart an active answer. */
const starts = new Map<string, { agentId: string; at: number }>()

export const answerClock = {
  start(sessionId: string, agentId: string, at = Date.now()): number {
    starts.set(sessionId, { agentId, at })
    return at
  },
  startedAt(sessionId: string, agentId: string): number {
    const current = starts.get(sessionId)
    return current?.agentId === agentId ? current.at : answerClock.start(sessionId, agentId)
  },
  end(sessionId: string): void {
    starts.delete(sessionId)
  },
}
