import { describe, expect, test } from 'bun:test'

import {
  initialPreviewOverlayState,
  previewOverlayReducer,
  selectPreviewOverlayKind,
} from './previewOverlayMachine'

describe('preview overlay state machine', () => {
  test('loaded wins over a late timeout for the same frame', () => {
    const loaded = previewOverlayReducer(initialPreviewOverlayState, {
      type: 'frame-loaded',
      frameKey: 'frame-1',
    })
    expect(previewOverlayReducer(loaded, { type: 'frame-timeout', frameKey: 'frame-1' })).toBe(
      loaded,
    )
  })

  test('a late load clears the timeout for that frame', () => {
    const timedOut = previewOverlayReducer(initialPreviewOverlayState, {
      type: 'frame-timeout',
      frameKey: 'frame-1',
    })
    const loaded = previewOverlayReducer(timedOut, {
      type: 'frame-loaded',
      frameKey: 'frame-1',
    })
    expect(loaded).toMatchObject({ loadedFrame: 'frame-1', unreachableFrame: null })
  })

  test('overlay precedence is stopped, blocked, unreachable, live', () => {
    expect(
      selectPreviewOverlayKind({
        status: 'stopped',
        frameBlocked: true,
        engaged: false,
        unreachable: true,
      }),
    ).toBe('stopped')
    expect(
      selectPreviewOverlayKind({
        status: 'running',
        frameBlocked: true,
        engaged: false,
        unreachable: true,
      }),
    ).toBe('blocked')
    expect(
      selectPreviewOverlayKind({
        status: 'running',
        frameBlocked: false,
        engaged: false,
        unreachable: true,
      }),
    ).toBe('unreachable')
    expect(
      selectPreviewOverlayKind({
        status: 'running',
        frameBlocked: false,
        engaged: false,
        unreachable: false,
      }),
    ).toBeNull()
  })
})
