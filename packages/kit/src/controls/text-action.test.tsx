import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TextAction } from './text-action'

describe('TextAction', () => {
  test('keeps native button semantics while inheriting inline text geometry', () => {
    const html = renderToStaticMarkup(
      <TextAction tooltip="Open src/app.ts:42">src/app.ts:42</TextAction>,
    )

    expect(html).toContain('<button')
    expect(html).toContain('type="button"')
    expect(html).toContain('data-slot="text-action"')
    expect(html).toContain('data-tooltip-trigger="true"')
    expect(html).toContain('font-[inherit]')
    expect(html).toContain('leading-[inherit]')
    expect(html).not.toContain('role="button"')
    expect(html).not.toContain('title=')
  })

  test('keeps a disabled explanation keyboard-reachable without enabling the action', () => {
    const html = renderToStaticMarkup(
      <TextAction tooltip="File is unavailable" disabled>
        Missing file
      </TextAction>,
    )

    expect(html).toContain('data-disabled-tooltip-anchor="true"')
    expect(html).toContain('aria-label="File is unavailable"')
    expect(html).toContain('disabled=""')
  })
})
