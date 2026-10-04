import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { EditingBanner } from './EditingBanner'

describe('EditingBanner presentation', () => {
  test('keeps edit context in a flat accent strip instead of another card', () => {
    const html = renderToStaticMarkup(
      <EditingBanner originalText={'Original\nmessage'} onCancel={() => {}} />,
    )

    expect(html).toContain('border-l-2')
    expect(html).toContain('Original message')
    expect(html).not.toContain('bg-surface-raised')
    expect(html).not.toContain('rounded-lg')
    expect(html).not.toContain('border-control-border')
  })
})
