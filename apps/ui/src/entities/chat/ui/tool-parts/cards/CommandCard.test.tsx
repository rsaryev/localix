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
    expect(html).toContain('data-tooltip-trigger="true"')
    expect(html).not.toContain('title=')
  })

  // LOCALIX-388: a server stopped at its timeout showed a red badge, as if it had failed.
  test('a stopped job is grey and says it was stopped, not red', () => {
    const html = renderToStaticMarkup(<BgBadge status="timeout" />)
    expect(html).not.toContain('bg-status-error')
    expect(html).toContain('stopped at its timeout')
  })
})
