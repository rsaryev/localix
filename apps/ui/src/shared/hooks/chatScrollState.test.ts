import { beforeEach, describe, expect, it } from 'bun:test'
import {
  MAX_MEASUREMENT_SNAPSHOTS,
  MAX_MEASUREMENTS_PER_SESSION,
  chatMeasurementsForWidth,
  clearChatScrollSnapshotsForTests,
  measurementsUsableAtWidth,
  getChatScrollSnapshot,
  hasChatScrollSnapshot,
  isUsableScrollViewport,
  restoredScrollTop,
  saveChatScrollSnapshot,
  saveChatVirtualMeasurements,
} from './chatScrollState'

beforeEach(clearChatScrollSnapshotsForTests)

describe('chatScrollState', () => {
  it('keeps independent positions and follow modes per session', () => {
    saveChatScrollSnapshot('a', { scrollTop: 420, follow: false })
    saveChatScrollSnapshot('b', { scrollTop: 900, follow: true })
    expect(getChatScrollSnapshot('a')).toEqual({ scrollTop: 420, follow: false })
    expect(getChatScrollSnapshot('b')).toEqual({ scrollTop: 900, follow: true })
  })

  it('restores reading position without chasing content appended while hidden', () => {
    expect(
      restoredScrollTop(
        { scrollTop: 420, follow: false },
        { scrollHeight: 2_000, clientHeight: 500 },
      ),
    ).toBe(420)
    expect(
      restoredScrollTop(
        { scrollTop: 420, follow: true },
        { scrollHeight: 2_000, clientHeight: 500 },
      ),
    ).toBe(1_500)
  })

  it('distinguishes a hidden zero-height pane from a usable viewport', () => {
    expect(isUsableScrollViewport({ clientHeight: 0 })).toBe(false)
    expect(isUsableScrollViewport({ clientHeight: 640 })).toBe(true)
  })

  it('reports whether a remounted session has state before the virtualizer pins it', () => {
    expect(hasChatScrollSnapshot('a')).toBe(false)
    saveChatScrollSnapshot('a', { scrollTop: 10, follow: false })
    expect(hasChatScrollSnapshot('a')).toBe(true)
  })

  it('keeps measured row geometry when later scroll events update only the offset', () => {
    const measurements = [{ index: 0, key: 'm1', start: 48, size: 180, end: 228, lane: 0 }]
    saveChatScrollSnapshot('a', { scrollTop: 100, follow: false })
    saveChatVirtualMeasurements('a', measurements, 720)
    saveChatScrollSnapshot('a', { scrollTop: 140, follow: false })

    expect(getChatScrollSnapshot('a')).toEqual({
      scrollTop: 140,
      follow: false,
      measurements,
      measurementWidth: 720,
    })
  })

  it('retains virtual measurements when child cleanup runs before the scroll hook cleanup', () => {
    const measurements = [{ index: 0, key: 'm1', start: 48, size: 180, end: 228, lane: 0 }]
    saveChatVirtualMeasurements('a', measurements, 720)
    saveChatScrollSnapshot('a', { scrollTop: 140, follow: false })

    const snapshot = getChatScrollSnapshot('a')
    expect(snapshot?.measurements).toEqual(measurements)
    expect(snapshot?.measurementWidth).toBe(720)
  })

  it('replays row geometry only at the width it was measured at', () => {
    const measurements = [{ index: 0, key: 'm1', start: 48, size: 180, end: 228, lane: 0 }]
    saveChatScrollSnapshot('a', { scrollTop: 140, follow: false })
    saveChatVirtualMeasurements('a', measurements, 720)
    const snapshot = getChatScrollSnapshot('a')

    expect(chatMeasurementsForWidth(snapshot, 720)).toEqual(measurements)
    // A narrower pane re-wraps every row, so the cached heights are not heights.
    expect(chatMeasurementsForWidth(snapshot, 480)).toBeUndefined()
    // One pixel is enough: the guard is an equality check, not a tolerance.
    expect(chatMeasurementsForWidth(snapshot, 719)).toBeUndefined()
    // The saved scroll position is width-independent and always survives.
    expect(snapshot?.scrollTop).toBe(140)
  })

  it('keeps geometry while the width is still unobservable', () => {
    // A viewport with no layout yet (first render, hidden warm tab) proves
    // nothing; the cache survives until a real width can judge it.
    expect(measurementsUsableAtWidth(720, 0)).toBe(true)
    expect(measurementsUsableAtWidth(720, Number.NaN)).toBe(true)
    expect(measurementsUsableAtWidth(720, 720)).toBe(true)
    expect(measurementsUsableAtWidth(720, 700)).toBe(false)
    // Geometry with no width recorded can never be validated → never replayed.
    expect(measurementsUsableAtWidth(undefined, 720)).toBe(false)
    expect(measurementsUsableAtWidth(0, 720)).toBe(false)
  })

  it('drops geometry captured from an unmeasurable viewport', () => {
    const measurements = [{ index: 0, key: 'm1', start: 48, size: 180, end: 228, lane: 0 }]
    saveChatScrollSnapshot('a', { scrollTop: 140, follow: false })
    saveChatVirtualMeasurements('a', measurements, 0)

    const snapshot = getChatScrollSnapshot('a')
    expect(snapshot?.measurements).toBeUndefined()
    expect(snapshot?.scrollTop).toBe(140)
  })

  it('bounds retained geometry by row count and recent session count', () => {
    const measurement = (index: number) => ({
      index,
      key: `m-${index}`,
      start: index * 10,
      size: 10,
      end: index * 10 + 10,
      lane: 0,
    })

    saveChatScrollSnapshot('oversized', { scrollTop: 100, follow: false })
    saveChatVirtualMeasurements(
      'oversized',
      Array.from({ length: MAX_MEASUREMENTS_PER_SESSION + 1 }, (_, index) => measurement(index)),
      720,
    )
    expect(getChatScrollSnapshot('oversized')?.measurements).toBeUndefined()

    for (let index = 0; index <= MAX_MEASUREMENT_SNAPSHOTS; index += 1) {
      const id = `session-${index}`
      saveChatScrollSnapshot(id, { scrollTop: index, follow: false })
      saveChatVirtualMeasurements(id, [measurement(index)], 720)
    }

    expect(getChatScrollSnapshot('session-0')?.measurements).toBeUndefined()
    expect(
      getChatScrollSnapshot(`session-${MAX_MEASUREMENT_SNAPSHOTS}`)?.measurements,
    ).toHaveLength(1)
  })
})
