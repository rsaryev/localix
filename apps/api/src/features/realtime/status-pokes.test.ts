import { describe, expect, test } from 'bun:test'
import { startStatusPokes } from './status-pokes'

function signal() {
  const listeners = new Set<() => void>()
  return {
    emit: () => listeners.forEach((listener) => listener()),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    get size() {
      return listeners.size
    },
  }
}

describe('startStatusPokes', () => {
  test('pokes the topic of the source that moved, at once for the first move', () => {
    const models = signal()
    const semantic = signal()
    const published: string[][] = []
    const stop = startStatusPokes(
      [
        { resource: 'local-models', subscribe: models.subscribe },
        { resource: 'semantic', subscribe: semantic.subscribe },
      ],
      (resources) => published.push(resources),
      60_000,
    )
    models.emit()
    semantic.emit()
    // Inside the window the burst waits for its one trailing poke.
    models.emit()
    models.emit()
    expect(published).toEqual([['local-models'], ['semantic']])
    stop()
  })

  test('stopping unsubscribes and drops the pending poke', () => {
    const models = signal()
    const published: string[][] = []
    const stop = startStatusPokes(
      [{ resource: 'local-models', subscribe: models.subscribe }],
      (resources) => published.push(resources),
      0,
    )
    stop()
    models.emit()
    expect(models.size).toBe(0)
    expect(published).toEqual([])
  })
})
