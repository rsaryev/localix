// Replays the emulated session against every model window (see the harness for what is real).
import { describe, expect, test } from 'bun:test'

import { resolveContextBudgetFrame } from './context-budget'
import {
  OVERHEAD,
  report,
  runSession,
  sessionDatabasePerFile,
  WINDOWS,
  type TurnLog,
} from './context-window-session.harness'
import { checkpointAtTokens } from './model-view/checkpoint-policy'

sessionDatabasePerFile()

describe('a 100-turn coding session across model windows', () => {
  const results = new Map<string, TurnLog[]>()

  for (const [label, options] of WINDOWS) {
    test(
      label,
      async () => {
        const logs = await runSession(options)
        results.set(label, logs)
        report(label, options, logs)
        const frame = resolveContextBudgetFrame({
          contextWindow: options.window,
          fixedOverheadTokens: OVERHEAD,
          depth: options.depth,
          contextLimit: options.limit,
        })

        // Every request the strategy ADMITS fits under the ceiling.
        for (const log of logs) expect(log.startEstimate).toBeLessThanOrEqual(frame.trigger)
        // A checkpoint is taken only when the measured size said so (or the view overflowed).
        for (const [i, log] of logs.entries()) {
          if (!log.checkpoint) continue
          const before = logs[i - 1]?.measured ?? 0
          expect(before >= checkpointAtTokens(frame) || log.checkpoint.reason !== 'threshold').toBe(
            true,
          )
          expect(log.checkpoint.requestAfter).toBeLessThan(checkpointAtTokens(frame))
          expect(log.checkpoint.requestAfter).toBeLessThan(before || Number.POSITIVE_INFINITY)
        }
        // However the turn's own traffic grows, a request never outgrows the physical window.
        for (const log of logs) expect(log.measured).toBeLessThanOrEqual(frame.rawWindow)
        // Between checkpoints the request is an exact byte prefix of the next: the cache stays warm.
        for (const log of logs) if (log.appendOnly !== undefined) expect(log.appendOnly).toBe(true)
      },
      120_000,
    )
  }
})
