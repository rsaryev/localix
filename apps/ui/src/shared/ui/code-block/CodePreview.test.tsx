import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CodePreview } from './CodePreview'

describe('CodePreview syntax guard', () => {
  test('syntax-highlights a preview only with a supported language', () => {
    const html = renderToStaticMarkup(
      <CodePreview code={'const answer = true'} language="typescript" />,
    )

    expect(html).toContain('sh__token--keyword')
    expect(html).toContain('const')
  })

  test('keeps unlabeled command output as plain escaped text', () => {
    const html = renderToStaticMarkup(<CodePreview code={'if true; then echo "<done>"; fi'} />)

    expect(html).not.toContain('sh__token')
    expect(html).toContain('&lt;done&gt;')
  })

  test('renders oversized input as escaped plain text when highlighting is disabled', () => {
    const html = renderToStaticMarkup(
      <CodePreview code={'echo "<unsafe>" && true'} syntaxHighlight={false} />,
    )

    expect(html).not.toContain('sh__token')
    expect(html).toContain('&lt;unsafe&gt;')
  })
})
