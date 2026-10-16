import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { FileReadonlyView } from './FileReadonlyView'
import { FileImageView } from './FileImageView'

describe('file viewer control placement', () => {
  test('reserves a toolbar above read-only code without covering its first line', () => {
    const html = renderToStaticMarkup(
      <FileReadonlyView path="example.ts" content="const firstLine = true" truncated={false} />,
    )
    expect(html).toContain('aria-label="File viewer actions"')
    expect(html).toContain('data-slot="workbench-toolbar"')
    expect(html).not.toContain('data-slot="floating-action-group"')
    expect(html.indexOf('data-slot="workbench-toolbar"')).toBeLessThan(html.indexOf('<pre'))
    expect(html).toContain('Soft-wrap long lines')
    expect(html).toContain('Copy file contents')
  })

  test('keeps image zoom and SVG source controls above the image', () => {
    const html = renderToStaticMarkup(
      <FileImageView
        path="example.svg"
        content='<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" />'
        mimeType="image/svg+xml"
        encoding="utf8"
        truncated={false}
      />,
    )
    expect(html).toContain('aria-label="Image viewer actions"')
    expect(html).toContain('data-slot="workbench-toolbar"')
    expect(html).not.toContain('data-slot="floating-action-group"')
    expect(html.indexOf('data-slot="workbench-toolbar"')).toBeLessThan(html.indexOf('<img'))
    expect(html).toContain('Zoom in (click image)')
    expect(html).toContain('Show raw source')
  })
})
