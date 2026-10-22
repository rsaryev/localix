import { describe, expect, test } from 'bun:test'
import { createEndpoint, type Message } from './endpoint'
import { WireError, decode, encode, type WireTable } from './wire'

/** What one side of the mods channel does with frames the other side, a mod's worker, forged. */

const REF = '\u0000lx'

function endpointWithOutbox(
  handlers: Record<string, (payload: never) => unknown> = {},
  limits?: { values: number; depth: number },
) {
  const sent: Message[] = []
  const malformed: string[] = []
  let arrived = () => {}
  const endpoint = createEndpoint({
    post(message) {
      sent.push(message)
      arrived()
    },
    handlers,
    ...(limits ? { limits } : {}),
    malformed: (reason) => void malformed.push(reason),
  })
  /** Resolves once `count` messages were posted. */
  const posted = (count: number) =>
    new Promise<void>((resolve) => {
      arrived = () => sent.length >= count && resolve()
      arrived()
    })
  return { endpoint, sent, malformed, posted }
}

const table: WireTable = {
  keep: () => 1,
  idOfStandIn: () => undefined,
  standIn: () => () => 'stand-in',
  kept: () => () => 'kept',
}

describe('decode', () => {
  test('refuses a reference encode would not make, and never tests a primitive for a key', () => {
    for (const forged of [
      { [REF]: 5 },
      { [REF]: null },
      { [REF]: 'fn' },
      { [REF]: [] },
      { [REF]: {} },
      { [REF]: { fn: 'x' } },
      { [REF]: { own: -1 } },
      { [REF]: { own: 1, fn: 2 } },
      { [REF]: { own: 1 }, more: true },
      { [REF]: { element: 'Script' } },
      { [REF]: { error: 'boom' } },
      { nested: [{ [REF]: 5 }] },
    ])
      expect(() => decode(forged, table)).toThrow(WireError)
  })

  test('reads what encode makes, and keeps a __proto__ key as data', () => {
    expect(decode({ [REF]: { error: { name: 'E', message: 'm' } } }, table)).toMatchObject({
      name: 'E',
      message: 'm',
    })
    const value = decode(JSON.parse('{"__proto__": {"polluted": true}}'), table) as object
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
    expect(Object.hasOwn(value, '__proto__')).toBe(true)
  })

  test('encode refuses a value that carries the reference key', () => {
    expect(() => encode({ ok: { [REF]: 5 } }, table)).toThrow(WireError)
  })
})

describe('an endpoint receiving forged frames', () => {
  test('a response that does not decode rejects its own request, without throwing', async () => {
    const { endpoint, sent } = endpointWithOutbox()
    const waiting = endpoint.request('call', {})
    const id = (sent[0] as { id: number }).id
    expect(() => endpoint.receive({ t: 'res', id, ok: true, value: { [REF]: 5 } })).not.toThrow()
    await expect(waiting).rejects.toThrow(WireError)
    const failing = endpoint.request('call', {})
    const next = (sent[1] as { id: number }).id
    endpoint.receive({ t: 'res', id: next, ok: false, error: { [REF]: { own: 'x' } } })
    await expect(failing).rejects.toThrow(WireError)
  })

  test('a request that does not decode is answered with the error', async () => {
    const { endpoint, sent, posted } = endpointWithOutbox({ api: () => 'ran' })
    endpoint.receive({ t: 'req', id: 7, type: 'api', payload: { [REF]: { fn: 0 } } })
    endpoint.receive({ t: 'req', id: 8, type: 'constructor', payload: {} })
    endpoint.receive({ t: 'note', type: 'api', payload: { [REF]: 5 } })
    await posted(2)
    expect(sent).toMatchObject([
      { t: 'res', id: 7, ok: false, error: { [REF]: { error: { name: 'WireError' } } } },
      {
        t: 'res',
        id: 8,
        ok: false,
        error: { [REF]: { error: { message: 'no handler for constructor' } } },
      },
    ])
  })

  test('a frame that is no message is reported as malformed, never thrown', () => {
    const { endpoint, malformed } = endpointWithOutbox()
    for (const frame of [null, 5, 'res', {}, { t: 'res' }, { t: 'req', id: 1 }, { t: 'other' }])
      expect(() => endpoint.receive(frame)).not.toThrow()
    expect(malformed).toHaveLength(7)
  })

  test('a request whose signal aborts rejects at once, and its late answer is dropped', async () => {
    const { endpoint, sent } = endpointWithOutbox()
    const controller = new AbortController()
    const waiting = endpoint.request('call', {}, controller.signal)
    controller.abort(new Error('the event was abandoned'))
    await expect(waiting).rejects.toThrow('the event was abandoned')
    const id = (sent[0] as { id: number }).id
    expect(() => endpoint.receive({ t: 'res', id, ok: true, value: 'late' })).not.toThrow()
    await expect(endpoint.request('call', {}, controller.signal)).rejects.toThrow('abandoned')
  })

  test('a value past the limits fails its own frame, at either end', async () => {
    const { endpoint, sent, posted } = endpointWithOutbox(
      { api: () => 'ran' },
      {
        values: 10,
        depth: 3,
      },
    )
    const waiting = endpoint.request('call', {})
    const id = (sent[0] as { id: number }).id
    endpoint.receive({ t: 'res', id, ok: true, value: Array.from({ length: 11 }, () => 0) })
    await expect(waiting).rejects.toThrow('more than 10 values')
    endpoint.receive({
      t: 'req',
      id: 7,
      type: 'api',
      payload: { a: { b: { c: { d: { e: 1 } } } } },
    })
    await posted(2)
    expect(sent[1]).toMatchObject({
      t: 'res',
      id: 7,
      ok: false,
      error: { [REF]: { error: { name: 'WireError', message: expect.stringContaining('deep') } } },
    })
  })
})
