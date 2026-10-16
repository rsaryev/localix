import { describe, expect, it } from 'bun:test'
import { classifyOsFamily } from '@localixai/kit/environment'

describe('OS family classification', () => {
  it('recognizes modern and legacy Apple platform strings', () => {
    expect(classifyOsFamily('macOS MacIntel')).toBe('mac')
    expect(classifyOsFamily('iPhone')).toBe('mac')
    expect(classifyOsFamily('iPad')).toBe('mac')
  })

  it('recognizes Windows, Linux, ChromeOS and X11', () => {
    expect(classifyOsFamily('Windows Win32')).toBe('windows')
    expect(classifyOsFamily('Linux x86_64')).toBe('linux')
    expect(classifyOsFamily('X11')).toBe('linux')
    expect(classifyOsFamily('CrOS')).toBe('linux')
  })

  it('fails closed for missing and unfamiliar platform text', () => {
    expect(classifyOsFamily('')).toBe('unknown')
    expect(classifyOsFamily('Plan 9')).toBe('unknown')
  })
})
