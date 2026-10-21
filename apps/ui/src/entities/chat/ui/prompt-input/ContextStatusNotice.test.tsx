import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ContextStatusNotice } from './ContextRefChips'

describe('ContextStatusNotice presentation', () => {
  test('uses icon tone without a colored warning capsule', () => {
    const html = renderToStaticMarkup(
      <ContextStatusNotice tone="error">Context is over budget</ContextStatusNotice>,
    )

    expect(html).toContain('lucide-triangle-alert')
    expect(html).toContain('text-status-error')
    expect(html).not.toContain('rounded-full')
    expect(html).not.toContain('bg-status-error')
    expect(html).not.toContain('border-status-error')
  })
})
