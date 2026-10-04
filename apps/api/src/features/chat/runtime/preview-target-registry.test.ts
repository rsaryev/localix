import { describe, expect, test } from 'bun:test'
import { createPreviewTargetRegistry } from './preview-target-registry'

describe('preview-target-registry', () => {
  test('record + get round-trips, starting un-opened', () => {
    const reg = createPreviewTargetRegistry()
    reg.record('u1', 's1', { url: 'http://localhost:5173/', startCommand: 'npm run dev' })
    expect(reg.get('u1', 's1')).toMatchObject({
      url: 'http://localhost:5173/',
      startCommand: 'npm run dev',
      opened: false,
    })
  })

  test('markOpened flips opened to true', () => {
    const reg = createPreviewTargetRegistry()
    reg.record('u1', 's1', { url: 'http://localhost:5173/' })
    reg.markOpened('u1', 's1')
    expect(reg.get('u1', 's1')?.opened).toBe(true)
  })

  test('a same-origin re-record keeps opened (a refresh of the same server)', () => {
    const reg = createPreviewTargetRegistry()
    reg.record('u1', 's1', { url: 'http://localhost:5173/' })
    reg.markOpened('u1', 's1')
    reg.record('u1', 's1', { url: 'http://localhost:5173/app' })
    expect(reg.get('u1', 's1')?.opened).toBe(true)
  })

  test('a DIFFERENT origin resets opened (a new/different server appeared)', () => {
    const reg = createPreviewTargetRegistry()
    reg.record('u1', 's1', { url: 'http://localhost:5173/' })
    reg.markOpened('u1', 's1')
    reg.record('u1', 's1', { url: 'http://localhost:3000/' })
    expect(reg.get('u1', 's1')).toMatchObject({ url: 'http://localhost:3000/', opened: false })
  })

  test('targets are scoped per user+session', () => {
    const reg = createPreviewTargetRegistry()
    reg.record('u1', 's1', { url: 'http://localhost:5173/' })
    expect(reg.get('u1', 's2')).toBeUndefined()
    expect(reg.get('u2', 's1')).toBeUndefined()
  })

  test('clear forgets the target so a closed preview is not lazily re-opened', () => {
    const reg = createPreviewTargetRegistry()
    reg.record('u1', 's1', { url: 'http://localhost:5173/' })
    reg.markOpened('u1', 's1')
    reg.clear('u1', 's1')
    expect(reg.get('u1', 's1')).toBeUndefined()
    // Clearing one session leaves another untouched.
    reg.record('u1', 's2', { url: 'http://localhost:3000/' })
    reg.clear('u1', 's1')
    expect(reg.get('u1', 's2')).toMatchObject({ url: 'http://localhost:3000/' })
  })

  test('bounds targets with LRU eviction and refreshes recency on get', () => {
    const reg = createPreviewTargetRegistry({ maxEntries: 2 })
    reg.record('u1', 's1', { url: 'http://localhost:3001/' })
    reg.record('u1', 's2', { url: 'http://localhost:3002/' })
    expect(reg.get('u1', 's1')).toBeDefined() // s2 is now least recently used
    reg.record('u1', 's3', { url: 'http://localhost:3003/' })

    expect(reg.get('u1', 's2')).toBeUndefined()
    expect(reg.get('u1', 's1')).toBeDefined()
    expect(reg.get('u1', 's3')).toBeDefined()
    expect(reg.size()).toBe(2)
  })

  test('rejects an invalid capacity', () => {
    expect(() => createPreviewTargetRegistry({ maxEntries: 0 })).toThrow('positive safe integer')
  })
})
