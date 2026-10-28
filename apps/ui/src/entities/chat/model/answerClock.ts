/** Run clocks live outside the composer: changing tabs must not restart an active answer. */
const starts = new Map<string, number>()

export const answerClock = {
  start(sessionId: string, at = Date.now()): number {
    starts.set(sessionId, at)
    return at
  },
  startedAt(sessionId: string): number {
    return starts.get(sessionId) ?? answerClock.start(sessionId)
  },
  end(sessionId: string): void {
    starts.delete(sessionId)
  },
}
