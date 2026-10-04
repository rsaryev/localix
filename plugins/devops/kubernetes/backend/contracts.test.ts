import { describe, expect, it } from 'bun:test'

import { podLogsQuerySchema, startPortForwardSchema } from './contracts'

// Query params arrive as strings on the wire — pin the string forms so the
// `previous` flag can never regress to Boolean('false') === true coercion.
describe('podLogsQuerySchema', () => {
  it('parses string booleans for ?previous=', () => {
    expect(podLogsQuerySchema.parse({ previous: 'true' }).previous).toBe(true)
    expect(podLogsQuerySchema.parse({ previous: 'false' }).previous).toBe(false)
    expect(podLogsQuerySchema.parse({}).previous).toBeUndefined()
  })

  it('rejects junk instead of coercing it', () => {
    expect(() => podLogsQuerySchema.parse({ previous: 'yolo' })).toThrow()
  })

  it('coerces incremental log windows within bounds', () => {
    expect(podLogsQuerySchema.parse({ tail: '500', sinceSeconds: '6' })).toMatchObject({
      tail: 500,
      sinceSeconds: 6,
    })
    expect(() => podLogsQuerySchema.parse({ tail: '0' })).toThrow()
    expect(() => podLogsQuerySchema.parse({ sinceSeconds: '0' })).toThrow()
  })
})

describe('startPortForwardSchema', () => {
  it('accepts zero as the explicit automatic-local-port sentinel', () => {
    expect(
      startPortForwardSchema.parse({
        pod: 'nginx-test',
        namespace: 'default',
        localPort: 0,
        podPort: 80,
      }).localPort,
    ).toBe(0)
  })

  it('still rejects invalid explicit local ports', () => {
    expect(() =>
      startPortForwardSchema.parse({
        pod: 'nginx-test',
        localPort: -1,
        podPort: 80,
      }),
    ).toThrow()
  })
})
