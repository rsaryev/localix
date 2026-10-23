import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChordRecorder } from './ChordRecorder'

describe('shortcut recorder presentation', () => {
  test('exposes an unpressed record action and named icon controls', () => {
    const html = renderToStaticMarkup(
      createElement(ChordRecorder, {
        chord: 'mod+k',
        overridden: true,
        conflictsFor: () => [],
        onRecord: () => {},
        onUnassign: () => {},
        onReset: () => {},
      }),
    )

    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('aria-label="Change shortcut"')
    expect(html).toContain('aria-label="Unassign shortcut"')
    expect(html).toContain('aria-label="Reset shortcut to default"')
  })
})
