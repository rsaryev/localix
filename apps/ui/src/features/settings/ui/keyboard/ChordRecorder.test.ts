import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChordRecorder } from './ChordRecorder'

const source = readFileSync(new URL('./ChordRecorder.tsx', import.meta.url), 'utf8')

describe('shortcut recorder presentation', () => {
  test('keeps warning color on the conflict notice, not the action fill', () => {
    expect(source).toContain('<TriangleAlert')
    expect(source).toContain('Assign anyway')
    expect(source).not.toContain('bg-status-warning/10')
    expect(source).not.toContain('border-status-warning/50')
  })

  test('uses the shared pressed-state action and named icon controls', () => {
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

    expect(html).toContain('data-slot="button"')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('aria-label="Change shortcut"')
    expect(html).toContain('aria-label="Unassign shortcut"')
    expect(html).toContain('aria-label="Reset shortcut to default"')
    expect(source).not.toContain('<button')
  })
})
