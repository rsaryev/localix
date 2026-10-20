import { describe, expect, test } from 'bun:test'
import { cropBox, elementShot } from './nativeShot'

describe('an element screenshot cut from the native capture', () => {
  test('the box is the element plus its margin, in capture pixels, clamped to the capture', () => {
    // A 2× capture of a 500×400 viewport.
    const capture = { width: 1000, height: 800 }
    expect(
      cropBox({ x: 100, y: 50, width: 200, height: 100 }, { width: 500, height: 400 }, capture),
    ).toEqual({ x: 140, y: 70, width: 520, height: 260 })
    // Near the corner the margin stops at the capture's edge.
    expect(
      cropBox({ x: 0, y: 0, width: 100, height: 40 }, { width: 500, height: 400 }, capture),
    ).toEqual({ x: 0, y: 0, width: 230, height: 92 })
  })

  test('an element out of the view has nothing to cut', () => {
    expect(
      cropBox(
        { x: 600, y: 0, width: 50, height: 50 },
        { width: 500, height: 400 },
        { width: 500, height: 400 },
      ),
    ).toBeNull()
  })

  test('without a capture on this platform, the probe rasterizes as before', async () => {
    const invoke = async (command: string) => {
      if (command === 'browser_snapshot') throw new Error('not yet supported on this platform')
      return null
    }
    const runInPage = async () => ({
      ok: true,
      result: {
        rect: { x: 0, y: 0, width: 10, height: 10 },
        viewport: { width: 100, height: 100 },
      },
    })
    expect(
      await elementShot(invoke, runInPage, 't', 'c', { action: 'screenshot', ref: 'e1' }),
    ).toBeNull()
  })

  test('a target the probe cannot locate falls back too', async () => {
    const runInPage = async () => ({ ok: false })
    expect(
      await elementShot(async () => null, runInPage, 't', 'c', { action: 'screenshot', ref: 'e9' }),
    ).toBeNull()
  })
})
