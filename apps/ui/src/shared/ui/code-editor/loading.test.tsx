import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CodeEditor } from './CodeEditor'

describe('editor startup', () => {
  test('shows the standard activity while Monaco loads, without adding a pane background', () => {
    const html = renderToStaticMarkup(
      <CodeEditor value="{}" language="json" ariaLabel="Response body" readOnly />,
    )
    expect(html).toContain('Opening editor')
    expect(html).toContain('lx-activity-orb')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('aria-readonly="true"')
    expect(html).not.toContain('bg-background')
    expect(html).not.toContain('bg-black')
  })
})
