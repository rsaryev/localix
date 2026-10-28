import { describe, expect, test } from 'bun:test'

import type { StoredMessagePayload } from '../../db/payload'
import type { MessageTiming } from './contracts'
import { addMessageTiming, deriveSessionTiming, emptySessionTiming } from './session-timing'
import { DEFAULT_AGENT_AUTHOR } from '../../db'

function timing(partial: Partial<MessageTiming>): MessageTiming {
  return {
    modelMs: 0,
    revealMs: 0,
    toolGenMs: 0,
    waitMs: 0,
    toolMs: 0,
    hitlMs: 0,
    idleMs: 0,
    totalMs: 0,
    turns: 0,
    tools: [],
    ...partial,
  }
}

function msg(t?: MessageTiming): StoredMessagePayload {
  return {
    id: 'm',
    role: 'assistant',
    from: DEFAULT_AGENT_AUTHOR,
    content: '',
    ...(t ? { timing: t } : {}),
  }
}

describe('deriveSessionTiming', () => {
  test('returns null when no message carries timing', () => {
    expect(deriveSessionTiming([msg(), msg()])).toBeNull()
  })

  test('sums timing across messages and counts runs/turns', () => {
    const agg = deriveSessionTiming([
      msg(
        timing({
          modelMs: 100,
          revealMs: 5,
          toolGenMs: 40,
          waitMs: 20,
          toolMs: 50,
          idleMs: 10,
          totalMs: 160,
          turns: 2,
        }),
      ),
      msg(),
      msg(
        timing({
          modelMs: 200,
          revealMs: 15,
          toolGenMs: 60,
          waitMs: 80,
          toolMs: 0,
          hitlMs: 30,
          idleMs: 20,
          totalMs: 250,
          turns: 1,
        }),
      ),
    ])
    expect(agg).toEqual({
      totalMs: 410,
      modelMs: 300,
      revealMs: 20,
      toolGenMs: 100,
      waitMs: 100,
      toolMs: 50,
      hitlMs: 30,
      idleMs: 30,
      turns: 3,
      runs: 2,
    })
  })

  test('legacy timing missing later-added fields folds to 0, never NaN', () => {
    // revealMs/toolGenMs/waitMs were added after some messages were persisted,
    // so old `payload.timing` JSON lacks them at runtime despite the type. The
    // `?? 0` guards in addMessageTiming must keep a missing field from poisoning
    // the whole aggregate with NaN. This locks that load-bearing behavior.
    const legacy = {
      modelMs: 100,
      toolMs: 10,
      hitlMs: 0,
      idleMs: 5,
      totalMs: 115,
      turns: 1,
    } as unknown as MessageTiming
    const agg = deriveSessionTiming([msg(legacy)])
    expect(agg).not.toBeNull()
    expect(agg!.revealMs).toBe(0)
    expect(agg!.toolGenMs).toBe(0)
    expect(agg!.waitMs).toBe(0)
    expect(agg!.modelMs).toBe(100)
    for (const value of Object.values(agg!)) expect(Number.isNaN(value)).toBe(false)
  })

  test('addMessageTiming is a pure fold over an empty aggregate', () => {
    const t = timing({ modelMs: 5, totalMs: 5, turns: 1 })
    expect(addMessageTiming(emptySessionTiming(), t)).toEqual({
      totalMs: 5,
      modelMs: 5,
      revealMs: 0,
      toolGenMs: 0,
      waitMs: 0,
      toolMs: 0,
      hitlMs: 0,
      idleMs: 0,
      turns: 1,
      runs: 1,
    })
  })
})
