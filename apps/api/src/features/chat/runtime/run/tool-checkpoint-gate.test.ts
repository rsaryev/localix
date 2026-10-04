import { describe, expect, it } from 'bun:test'

import { createToolCheckpointGate } from './tool-checkpoint-gate'

describe('tool checkpoint gate', () => {
  it('waits for the host writer after Pi announces the tool turn', async () => {
    const abort = new AbortController()
    let completed: number | undefined
    const gate = createToolCheckpointGate({ signal: abort.signal, completedIndex: () => completed })
    const pending = gate.waitFor(1)
    completed = 1
    gate.notify(1)
    expect(await pending).toBe(true)
    expect(await gate.waitFor(1)).toBe(true)
    abort.abort()
    expect(await gate.waitFor(1)).toBe(false)
  })

  it('leaves the report queued on cancellation or an absent checkpoint', async () => {
    const abort = new AbortController()
    const gate = createToolCheckpointGate({
      signal: abort.signal,
      completedIndex: () => undefined,
      timeoutMs: 1,
    })
    expect(await gate.waitFor(2)).toBe(false)
    const waiting = gate.waitFor(3)
    abort.abort()
    expect(await waiting).toBe(false)
    gate.notify(3)
  })
})
