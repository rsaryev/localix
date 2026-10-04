import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { BgBadge, ExitBadge } from './CommandCard'

describe('CommandCard status badges', () => {
  test('uses shared status dots without tinted badge surfaces', () => {
    const html = renderToStaticMarkup(
      <>
        <BgBadge status="completed" />
        <ExitBadge code={1} />
      </>,
    )

    expect(html).toContain('bg-status-success')
    expect(html).toContain('bg-status-error')
    expect(html).toContain('exit 1')
    expect(html).not.toContain('bg-status-success/15')
    expect(html).not.toContain('bg-status-error/15')
    expect(html).not.toContain('bg-surface-active')
    expect(html).toContain('data-tooltip-trigger="true"')
    expect(html).not.toContain('title=')
  })
})
