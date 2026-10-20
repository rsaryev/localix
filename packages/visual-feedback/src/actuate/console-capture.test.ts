/**
 * installConsoleCapture — the ring buffer behind `browser console`: captures
 * console.* + window errors with a level, serializes non-string args, caps to `limit`
 * (oldest dropped), and restores the original console on uninstall.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { installConsoleCapture } from './index'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

describe('installConsoleCapture', () => {
  it('captures levels and JSON-serializes non-string args', () => {
    const cap = installConsoleCapture()
    try {
      console.log('hello', { a: 1 })
      console.warn('careful')
      const entries = cap.read()
      expect(entries).toContainEqual({ level: 'log', text: 'hello {"a":1}' })
      expect(entries).toContainEqual({ level: 'warn', text: 'careful' })
    } finally {
      cap.uninstall()
    }
  })

  it('caps the ring buffer to `limit`, dropping the oldest', () => {
    const cap = installConsoleCapture(3)
    try {
      for (let i = 1; i <= 5; i++) console.log(`m${i}`)
      const texts = cap.read().map((e) => e.text)
      expect(texts).toEqual(['m3', 'm4', 'm5']) // oldest two dropped
    } finally {
      cap.uninstall()
    }
  })

  it('captures window error events as level "error"', () => {
    const cap = installConsoleCapture()
    try {
      window.dispatchEvent(new ErrorEvent('error', { message: 'kaboom' }))
      expect(cap.read()).toContainEqual({ level: 'error', text: 'kaboom' })
    } finally {
      cap.uninstall()
    }
  })

  it('restores the original console methods on uninstall', () => {
    const original = console.log
    const cap = installConsoleCapture()
    expect(console.log).not.toBe(original) // wrapped while installed
    cap.uninstall()
    expect(console.log).toBe(original) // restored
  })

  it('cursor() + read(sinceSeq) return only entries recorded since the cursor', () => {
    const cap = installConsoleCapture()
    try {
      console.log('before')
      const c = cap.cursor() // snapshot the cursor
      console.warn('during-1')
      console.error('during-2')
      const since = cap.read(c)
      expect(since.map((e) => e.text)).toEqual(['during-1', 'during-2']) // not "before"
      expect(cap.read().map((e) => e.text)).toEqual(['before', 'during-1', 'during-2']) // full history
    } finally {
      cap.uninstall()
    }
  })

  it('cursor advances monotonically even after ring-buffer eviction', () => {
    const cap = installConsoleCapture(2) // tiny buffer
    try {
      const c = cap.cursor()
      for (let i = 0; i < 5; i++) console.log(`m${i}`)
      // Only the last 2 survive eviction, but read(sinceCursor) must not return stale/none.
      expect(cap.read(c).map((e) => e.text)).toEqual(['m3', 'm4'])
      const c2 = cap.cursor()
      expect(cap.read(c2)).toEqual([]) // nothing since "now"
    } finally {
      cap.uninstall()
    }
  })

  it('note() records a synthetic entry (default level warn) straight into the buffer', () => {
    const cap = installConsoleCapture()
    try {
      const c = cap.cursor()
      cap.note('[dialog] alert("hi") auto-dismissed')
      cap.note('custom error', 'error')
      const since = cap.read(c)
      expect(since).toContainEqual({ level: 'warn', text: '[dialog] alert("hi") auto-dismissed' })
      expect(since).toContainEqual({ level: 'error', text: 'custom error' })
    } finally {
      cap.uninstall()
    }
  })
})

describe('a logged value costs at most what the entry keeps', () => {
  it('a huge object is previewed by its top-level keys, never serialized whole', async () => {
    const { previewArg } = await import('./console-capture')
    let reads = 0
    const deep = {
      inner: {
        get secret() {
          reads++
          return 1
        },
      },
    }
    const huge = Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [`k${i}`, i]))
    expect(previewArg(deep)).toBe('{"inner":{…}}')
    expect(reads).toBe(0)
    const text = previewArg(huge)
    expect(text.length).toBeLessThanOrEqual(500)
    expect(text.startsWith('{"k0":0,"k1":1')).toBe(true)
    expect(previewArg([1, 'a', [2, 3], null])).toBe('[1,"a",[2],null]')
    expect(previewArg(new TypeError('boom'))).toBe('TypeError: boom')
  })
})
