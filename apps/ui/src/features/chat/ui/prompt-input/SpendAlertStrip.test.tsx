import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SpendAlertRow } from './SpendAlertStrip'

describe('SpendAlertRow presentation', () => {
  test('keeps warning color on the status glyph without tinting the composer', () => {
    const html = renderToStaticMarkup(
      <SpendAlertRow cost={2.5} threshold={1} level={2} onDismiss={() => {}} />,
    )

    expect(html).toContain('lucide-circle-dollar-sign')
    expect(html).toContain('Spend alert')
    expect(html).toContain('2×')
    expect(html).toContain('border-border')
    expect(html).not.toContain('bg-status-warning')
    expect(html).not.toContain('border-status-warning')
  })
})
