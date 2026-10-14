import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { EditorFontPreview } from './EditorFontPreview'

describe('editor font preview', () => {
  test('looks like an IDE fragment without fake window controls', () => {
    const html = renderToStaticMarkup(<EditorFontPreview fontCss="monospace" fontSize="13px" />)

    expect(html).toContain('lucide-file-code-corner')
    expect(html).toContain('preview.ts')
    expect(html).toContain('border-y')
    expect(html).not.toContain('bg-status-error')
    expect(html).not.toContain('bg-status-warning')
    expect(html).not.toContain('bg-status-success')
    expect(html).not.toContain('rounded-xl')
    expect(html).not.toContain('shadow-sm')
  })
})
