import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkingIndicator } from './WorkingIndicator'

describe('WorkingIndicator', () => {
  test('uses the shared Localix orb and a width-stable label without an ellipsis', () => {
    const html = renderToStaticMarkup(<WorkingIndicator label="Working…" />)

    expect(html).toContain('lx-activity-orb')
    expect(html).toContain('data-state="working"')
    expect(html).toContain('>Working</span>')
    expect(html).not.toContain('rounded-full')
    expect(html).not.toContain('Working…')
  })
})
