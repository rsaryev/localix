import { describe, expect, test } from 'bun:test'
import { mapLimit } from './map-limit'

describe('mapLimit', () => {
  test('preserves input order while bounding concurrent work', async () => {
    let inFlight = 0
    let peak = 0

    const gates = [0, 1, 2, 3].map(() => Promise.withResolvers<void>())
    const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

    const running = mapLimit([0, 1, 2, 3], 2, async (index) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await gates[index]!.promise
      inFlight--
      return index * 2
    })
    // Finish out of order: later items complete before earlier ones.
    for (const index of [1, 2, 0, 3]) {
      await turn()
      gates[index]!.resolve()
    }

    expect(await running).toEqual([0, 2, 4, 6])
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
