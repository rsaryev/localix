import { describe, expect, it } from 'bun:test'

import { createToolCheckpointGate, takeSteeringAtCheckpoint } from './tool-checkpoint-gate'

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

  it('cannot split a text-only response while the host is still consuming its events', async () => {
    let completed: number | undefined
    const gate = createToolCheckpointGate({
      signal: new AbortController().signal,
      completedIndex: () => completed,
    })
    let took = false
    const pending = takeSteeringAtCheckpoint({
      boundary: { completedTurnIndex: 2 },
      waitFor: gate.waitFor,
      onToolBoundary: () => {},
      take: async () => {
        took = true
        return ['interjection']
      },
    })
    await Promise.resolve()
    expect(took).toBe(false)
    completed = 2
    gate.notify(2)
    expect(await pending).toEqual(['interjection'])
    expect(took).toBe(true)
  })

  it('does not acknowledge or split a turn when the host checkpoint is missing', async () => {
    let took = false
    expect(
      await takeSteeringAtCheckpoint({
        boundary: { completedTurnIndex: 2, completedToolTurnIndex: 2 },
        waitFor: async () => false,
        onToolBoundary: () => {},
        take: async () => {
          took = true
          return ['interjection']
        },
      }),
    ).toEqual([])
    expect(took).toBe(false)
  })
})
