import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkItemSessionProvider } from '@localixai/plugin-sdk/ui/work-item-session'
import { CodeBlock } from './CodeBlock'

describe('CodeBlock chrome', () => {
  test('uses a compact semantic caption with a separate named action group', () => {
    // Inside a chat, as a transcript renders it: "Send to terminal" exists only where a chat does.
    const html = renderToStaticMarkup(
      <WorkItemSessionProvider sessionId="s1">
        <CodeBlock code="echo ready" language="bash" syntaxHighlight={false} />
      </WorkItemSessionProvider>,
    )

    expect(html).toContain('<figcaption')
    expect(html).toContain('data-slot="workbench-toolbar"')
    expect(html).toContain('h-[var(--chrome-control-md)]')
    expect(html).toContain('aria-label="bash code block controls"')
    expect(html).toContain('aria-label="Code block actions"')
    expect(html).toContain('aria-label="Send to terminal"')
    expect(html).toContain('aria-label="Copy code"')
    expect(html.match(/data-slot="button"/g)).toHaveLength(2)
    expect(html).not.toContain('<span>Run</span>')
    expect(html).not.toContain('<span>Copy</span>')
  })

  test('keeps bare file-viewer mode free of nested chrome', () => {
    const html = renderToStaticMarkup(
      <CodeBlock code="const ready = true" language="ts" syntaxHighlight={false} bare />,
    )

    expect(html).not.toContain('<figcaption')
    expect(html).not.toContain('data-slot="workbench-toolbar"')
    expect(html).not.toContain('data-slot="button"')
  })

  test.each(['json', 'text'])(
    'keeps CRLF and line-number gutters consistent for %s',
    (language) => {
      const numbered = renderToStaticMarkup(
        <CodeBlock code={'{\r\n  "ready": true\r\n}'} language={language} bare lineNumbers />,
      )
      const plain = renderToStaticMarkup(
        <CodeBlock code={'{\n  "ready": true\n}'} language={language} bare />,
      )

      expect(numbered).toContain('code-line-numbers')
      expect(numbered.match(/class="sh__line"/g)).toHaveLength(3)
      expect(numbered).not.toContain('\r')
      expect(plain).not.toContain('code-line-numbers')
    },
  )
})
