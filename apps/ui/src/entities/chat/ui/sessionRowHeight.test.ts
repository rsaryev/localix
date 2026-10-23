import { describe, expect, test } from 'bun:test'
import { readKitStylesheet } from '@localixai/kit/testing/stylesheet'

const css = readKitStylesheet()

describe('session row height', () => {
  test('fits the action control inside the compact row', () => {
    const declared = css.match(/--session-row-height:\s*(\d+)px/)
    const control = css.match(/--chrome-control-sm:\s*(\d+)px/)
    expect(Number(declared?.[1])).toBeGreaterThanOrEqual(Number(control?.[1]) + 8)
    expect(Number(declared?.[1])).toBeLessThanOrEqual(36)
  })
})
