import { describe, expect, test } from 'bun:test'
import { mapLimit } from './map-limit'

describe('mapLimit', () => {
  test('preserves input order while bounding concurrent work', async () => {
    let inFlight = 0
    let peak = 0

    const results = await mapLimit([30, 5, 20, 1], 2, async (delay) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await Bun.sleep(delay)
      inFlight--
      return delay * 2
    })

    expect(results).toEqual([60, 10, 40, 2])
    expect(peak).toBe(2)
  })

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid concurrency limit %p',
    async (limit) => {
      let called = false
      await Promise.resolve(
        expect(
          mapLimit([1], limit, async () => {
            called = true
            return 1
          }),
        ).rejects.toThrow('mapLimit limit must be a positive safe integer'),
      )
      expect(called).toBe(false)
    },
  )
})
