import { describe, it, expect } from 'bun:test'
import { PREVIEW_PORT_PRESETS, presetUrl } from './previewPortPresets'

describe('previewPortPresets', () => {
  it('has unique ports and valid port numbers', () => {
    const ports = PREVIEW_PORT_PRESETS.map((p) => p.port)
    expect(new Set(ports).size).toBe(ports.length)
    for (const port of ports) {
      expect(Number.isInteger(port)).toBe(true)
      expect(port).toBeGreaterThan(0)
      expect(port).toBeLessThanOrEqual(65535)
    }
  })

  it('has a non-empty label for every preset', () => {
    for (const preset of PREVIEW_PORT_PRESETS) {
      expect(preset.label.trim().length).toBeGreaterThan(0)
    }
  })

  it('builds a localhost URL for a port', () => {
    expect(presetUrl(3000)).toBe('http://localhost:3000/')
    expect(presetUrl(5173)).toBe('http://localhost:5173/')
  })
})
