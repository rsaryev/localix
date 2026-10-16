import { describe, expect, test } from 'bun:test'
import { PerformanceObserver, performance as nodePerformance } from 'node:perf_hooks'
import { installReactPerformanceCleanup } from './reactPerformanceCleanup'

describe('React development performance retention', () => {
  test('releases cloned render props while keeping application measures and returned entries', () => {
    const timeline = nodePerformance as unknown as Performance
    const dispose = installReactPerformanceCleanup(timeline)
    try {
      timeline.measure('localix.test.application', { start: 0, duration: 1 })
      let entry: PerformanceMeasure | undefined
      for (let index = 0; index < 10_000; index++) {
        entry = timeline.measure('\u200bLocalixTestMessage', {
          start: 0,
          duration: 1,
          detail: {
            devtools: { track: 'Components ⚛', properties: [['message', 'x'.repeat(1_000)]] },
          },
        })
      }
      expect(timeline.getEntriesByName('\u200bLocalixTestMessage')).toHaveLength(0)
      expect(timeline.getEntriesByName('localix.test.application')).toHaveLength(1)
      expect(entry?.detail.devtools.properties[0][1]).toHaveLength(1_000)
    } finally {
      dispose()
      timeline.clearMeasures('localix.test.application')
      timeline.clearMeasures('\u200bLocalixTestMessage')
    }
  })

  test('scheduler measures still reach a recording observer', async () => {
    const timeline = nodePerformance as unknown as Performance
    const dispose = installReactPerformanceCleanup(timeline)
    const entries: string[] = []
    const observer = new PerformanceObserver((list) => {
      entries.push(...list.getEntries().map((entry) => entry.name))
    })
    observer.observe({ entryTypes: ['measure'] })
    try {
      timeline.measure('LocalixTestUpdate', {
        start: 0,
        duration: 1,
        detail: { devtools: { track: 'Blocking', trackGroup: 'Scheduler ⚛' } },
      })
      await new Promise((resolve) => setImmediate(resolve))
      expect(timeline.getEntriesByName('LocalixTestUpdate')).toHaveLength(0)
      expect(entries).toContain('LocalixTestUpdate')
    } finally {
      observer.disconnect()
      dispose()
      timeline.clearMeasures('LocalixTestUpdate')
    }
  })

  test('preserves mark-based overloads and native validation failures', () => {
    const timeline = nodePerformance as unknown as Performance
    const original = timeline.measure
    const dispose = installReactPerformanceCleanup(timeline)
    try {
      timeline.mark('localix.test.start')
      timeline.mark('localix.test.end')
      expect(
        timeline.measure('localix.test.marks', 'localix.test.start', 'localix.test.end').duration,
      ).toBeGreaterThanOrEqual(0)
      expect(() => timeline.measure('localix.test.invalid', 'localix.test.missing')).toThrow()
    } finally {
      dispose()
      expect(timeline.measure).toBe(original)
      timeline.clearMarks('localix.test.start')
      timeline.clearMarks('localix.test.end')
      timeline.clearMeasures('localix.test.marks')
    }
  })
})
