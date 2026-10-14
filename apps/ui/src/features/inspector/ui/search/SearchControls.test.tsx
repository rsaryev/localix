import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Text } from 'lucide-react'
import { ContextLinesField, GlobField, Toggle } from './SearchTreeView'

describe('file search controls', () => {
  test('renders binary search options as accessible shared icon toggles', () => {
    const html = renderToStaticMarkup(
      <Toggle active onClick={() => {}} title="Search file contents">
        <Text />
      </Toggle>,
    )

    expect(html).toContain('aria-label="Search file contents"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('size-[var(--chrome-control-xs)]')
  })

  test('names the context-line group and each choice without claiming radio keyboard semantics', () => {
    const html = renderToStaticMarkup(<ContextLinesField value={2} onChange={() => {}} />)

    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="Context lines"')
    expect(html).toContain('aria-label="No surrounding lines"')
    expect(html).toContain('aria-label="2 lines of context"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).not.toContain('role="radio"')
  })

  test('associates glob fields and clear actions with explicit names', () => {
    const html = renderToStaticMarkup(
      <GlobField
        label="files to include"
        value="src/**"
        onChange={() => {}}
        placeholder="e.g. *.ts"
      />,
    )

    expect(html).toContain('data-slot="input-group"')
    expect(html).toContain('aria-label="files to include"')
    expect(html).toContain('aria-label="Clear files to include"')
  })
})
