import { describe, expect, it } from 'bun:test'

import {
  PREVIEW_VIEWPORT_FILL,
  PREVIEW_VIEWPORT_PRESETS,
  isFixedViewport,
  matchViewportPreset,
  rotateViewport,
  viewportSizeLabel,
} from './previewViewportPresets'

describe('previewViewportPresets', () => {
  it('leads with the fill preset so the default needs no lookup', () => {
    expect(PREVIEW_VIEWPORT_PRESETS[0]).toBe(PREVIEW_VIEWPORT_FILL)
    expect(isFixedViewport(PREVIEW_VIEWPORT_FILL)).toBe(false)
  })

  it('gives every other preset a real CSS viewport', () => {
    for (const p of PREVIEW_VIEWPORT_PRESETS.slice(1)) {
      expect(isFixedViewport(p)).toBe(true)
      expect(p.width).toBeGreaterThan(0)
      expect(p.height).toBeGreaterThan(0)
    }
  })

  it('rotates a fixed preset and leaves the fill preset alone', () => {
    const ipad = PREVIEW_VIEWPORT_PRESETS.find((p) => p.label === 'iPad Mini')!
    expect(rotateViewport(ipad)).toMatchObject({ width: 1024, height: 768 })
    expect(rotateViewport(PREVIEW_VIEWPORT_FILL)).toEqual(PREVIEW_VIEWPORT_FILL)
  })

  it('labels only fixed sizes', () => {
    expect(viewportSizeLabel({ label: 'x', width: 393, height: 852 })).toBe('393 × 852')
    expect(viewportSizeLabel(PREVIEW_VIEWPORT_FILL)).toBeNull()
  })

  it('matches a preset back from its size regardless of orientation', () => {
    expect(matchViewportPreset(393, 852).label).toBe('iPhone 15 Pro')
    // Rotated — the menu must still show the device as the active row.
    expect(matchViewportPreset(852, 393).label).toBe('iPhone 15 Pro')
  })

  it('falls back to fill for a null or unknown size', () => {
    expect(matchViewportPreset(null, null)).toBe(PREVIEW_VIEWPORT_FILL)
    expect(matchViewportPreset(1234, 5678)).toBe(PREVIEW_VIEWPORT_FILL)
  })
})
