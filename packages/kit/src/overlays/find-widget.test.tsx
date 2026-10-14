import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { FindWidgetCount, FindWidgetInput, FindWidgetSurface } from './find-widget'

describe('FindWidget primitives', () => {
  test('owns one responsive editor-widget surface and input geometry', () => {
    const html = renderToStaticMarkup(
      <FindWidgetSurface aria-label="Find in output">
        <FindWidgetInput aria-label="Search output" placeholder="Find" />
      </FindWidgetSurface>,
    )

    expect(html).toContain('data-slot="find-widget"')
    expect(html).toContain('role="search"')
    expect(html).toContain('aria-label="Find in output"')
    expect(html).toContain('max-w-[calc(100%-1rem)]')
    expect(html).toContain('shadow-(--shadow-popover)')
    expect(html).toContain('has-[:focus-visible]:ring-control-border-focus')
    expect(html).toContain('data-slot="find-widget-input"')
    expect(html).toContain('h-[var(--chrome-control-sm)]')
    expect(html).toContain('autoComplete="off"')
    expect(html).toContain('spellCheck="false"')
  })

  test('clamps counts and exposes empty, match, and no-result announcements', () => {
    const html = renderToStaticMarkup(
      <>
        <FindWidgetCount query="" count={0} index={0} />
        <FindWidgetCount query="needle" count={3} index={9} />
        <FindWidgetCount query="missing" count={0} index={0} />
      </>,
    )

    expect(html).toContain('data-state="empty"')
    expect(html).toContain('aria-label="No search query"')
    expect(html).toContain('data-state="matches"')
    expect(html).toContain('aria-label="3 of 3 matches"')
    expect(html).toContain('>3/3</output>')
    expect(html).toContain('data-state="no-results"')
    expect(html).toContain('aria-label="No matches"')
    expect(html).toContain('data-[state=no-results]:text-status-error')
    expect(html.match(/aria-live="polite"/g)).toHaveLength(3)
  })
})
