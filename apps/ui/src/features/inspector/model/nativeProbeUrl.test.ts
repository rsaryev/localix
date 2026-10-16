import { describe, expect, test } from 'bun:test'
import { nativeProbeUrl } from './nativeProbeUrl'

describe('nativeProbeUrl', () => {
  test('bypasses the Vite HTML fallback in development', () => {
    expect(nativeProbeUrl('http://localhost:5050', true, 'http://127.0.0.1:5051')).toBe(
      'http://127.0.0.1:5051/vf/native-probe.js',
    )
  })

  test('uses the embedded desktop API origin in production', () => {
    expect(nativeProbeUrl('http://127.0.0.1:61000', false, undefined)).toBe(
      'http://127.0.0.1:61000/vf/native-probe.js',
    )
  })
})
