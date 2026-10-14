import { describe, expect, test } from 'bun:test'
import { createKeyedSerializer } from './keyed-serializer'

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('createKeyedSerializer', () => {
  test('same key runs strictly in issue order (newest issued lands last)', async () => {
    const s = createKeyedSerializer()
    const log: string[] = []
    // op1 is slow, op2 fast — without serialization op2 would finish first.
    const p1 = s('m', async () => {
      await tick(20)
      log.push('1')
    })
    const p2 = s('m', async () => {
      await tick(1)
      log.push('2')
    })
    await Promise.all([p1, p2])
    expect(log).toEqual(['1', '2']) // issue order preserved despite op1 being slower
  })

  test('different keys run concurrently', async () => {
    const s = createKeyedSerializer()
    const log: string[] = []
    const a = s('a', async () => {
      await tick(20)
      log.push('a')
    })
    const b = s('b', async () => {
      await tick(1)
      log.push('b')
    })
    await Promise.all([a, b])
    expect(log).toEqual(['b', 'a']) // b not blocked behind a's slow op
  })

  test('a rejecting op does NOT block or poison later ops on the same key', () => {
    const s = createKeyedSerializer()
    const log: string[] = []
    const bad = s('m', async () => {
      throw new Error('boom')
    })
    expect(bad).rejects.toThrow('boom') // caller sees its own error
    const good = s('m', async () => {
      log.push('ok')
    })
    expect(good).resolves.toBeUndefined()
    expect(log).toEqual(['ok'])
  })

  test('caller receives the op return value', async () => {
    const s = createKeyedSerializer()
    expect(await s('m', async () => 42)).toBe(42)
  })

  test('self-cleans: a fully-drained key leaves no leak (re-run still ordered)', async () => {
    const s = createKeyedSerializer()
    await s('m', async () => {})
    await tick(1) // let the finally cleanup run
    const log: string[] = []
    await Promise.all([
      s('m', async () => {
        await tick(10)
        log.push('x')
      }),
      s('m', async () => {
        log.push('y')
      }),
    ])
    expect(log).toEqual(['x', 'y'])
  })
})
