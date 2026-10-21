import { describe, expect, test } from 'bun:test'
import { readKitStylesheet } from '@localixai/kit/testing/stylesheet'
import { SESSION_ROW_HEIGHT_CLASS } from './SessionRowContent'

const css = readKitStylesheet()

describe('session row height', () => {
  test('fits the action control inside the compact row', () => {
    const declared = css.match(/--session-row-height:\s*(\d+)px/)
    const control = css.match(/--chrome-control-sm:\s*(\d+)px/)
    expect(Number(declared?.[1])).toBeGreaterThanOrEqual(Number(control?.[1]) + 8)
    expect(Number(declared?.[1])).toBeLessThanOrEqual(36)
  })

  test('the class is the token, in the form that actually generates', () => {
    // Not `h-[52px]`: invisible to the one geometry scale (`ui-geometry-guard`). Not an
    // interpolated class: Tailwind scans source text and would emit no rule. And not the
    // `(--var)` shorthand, which emitted nothing here either — rows kept their content
    // heights, so the list visibly changed size when a row gained a second line.
    expect(SESSION_ROW_HEIGHT_CLASS).toBe('h-[var(--session-row-height)]')
  })
})
