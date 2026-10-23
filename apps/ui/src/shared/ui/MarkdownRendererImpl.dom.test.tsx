import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { WorkItemSessionProvider } from '@localixai/mini-app-sdk/ui/work-item-session'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

describe('live Markdown renderer', () => {
  test('with raw HTML off, a document from outside keeps its Markdown and drops its tags', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { default: MarkdownRendererImpl } = await import('./MarkdownRendererImpl')
    const host = document.createElement('div')
    const root = createRoot(host)
    const readme = '# Notes\n\n<p align="center"><b>Bold</b></p>\n\nPlain **strong** text.'
    try {
      await act(async () =>
        root.render(<MarkdownRendererImpl rawHtml={false}>{readme}</MarkdownRendererImpl>),
      )
      expect(host.querySelector('h1')?.textContent).toBe('Notes')
      expect(host.querySelector('strong')?.textContent).toBe('strong')
      expect(host.querySelector('p[align], b')).toBeNull()
    } finally {
      await act(async () => root.unmount())
    }
  })

  test('does not erase ordinary prose beginning with a pipe', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { default: MarkdownRendererImpl } = await import('./MarkdownRendererImpl')
    const host = document.createElement('div')
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(<MarkdownRendererImpl isStreaming>{'| literal'}</MarkdownRendererImpl>),
      )
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60))
      })
      expect(host.querySelector('p')?.textContent).toContain('| literal')
    } finally {
      await act(async () => root.unmount())
    }
  })

  test('keeps a completed table formatted while following prose streams', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { default: MarkdownRendererImpl } = await import('./MarkdownRendererImpl')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const table = '| Priority | Result |\n| --- | --- |\n| P1 | Fixed |\n\n'

    try {
      await act(async () =>
        root.render(<MarkdownRendererImpl isStreaming>{table}</MarkdownRendererImpl>),
      )
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60))
      })
      expect(host.querySelector('table')?.textContent).toContain('Fixed')

      await act(async () =>
        root.render(<MarkdownRendererImpl isStreaming>{`${table}More text`}</MarkdownRendererImpl>),
      )
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60))
      })
      expect(host.querySelector('table')?.textContent).toContain('Fixed')
      // The paced reveal need only have started; the stream remains live.
      expect(host.textContent).toContain('M')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
afterAll(() => teardown())

describe('Markdown artifact links', () => {
  test('a canonical Localix file link opens the in-app viewer', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { default: MarkdownRendererImpl } = await import('./MarkdownRendererImpl')
    const { registerInspectorHandler } = await import('@/shared/lib/inspectorBus')
    const requests: unknown[] = []
    const stop = registerInspectorHandler((request) => requests.push(request))
    const href = 'localix://ui/work-item/file?path=docs%2Freport.pdf&line=3'

    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <WorkItemSessionProvider sessionId="s1">
          <MarkdownRendererImpl>{`[Open report](${href})`}</MarkdownRendererImpl>
        </WorkItemSessionProvider>,
      ),
    )

    const link = host.querySelector<HTMLAnchorElement>('a')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    await act(async () => {
      link?.dispatchEvent(click)
    })
    expect(click.defaultPrevented).toBe(true)
    // In the chat whose transcript shows the link — never the one on screen.
    expect(requests.at(-1)).toEqual({
      kind: 'file',
      sessionId: 's1',
      path: 'docs/report.pdf',
      line: 3,
    })

    await act(async () => root.unmount())
    stop()
  })

  test('outside any chat a file link stays text: no workspace is guessed for it', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { default: MarkdownRendererImpl } = await import('./MarkdownRendererImpl')
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <MarkdownRendererImpl>
          {'[Open report](localix://ui/work-item/file?path=docs%2Freport.pdf)'}
        </MarkdownRendererImpl>,
      ),
    )

    expect(host.querySelector('a')).toBeNull()
    expect(host.textContent).toContain('Open report')

    await act(async () => root.unmount())
  })

  test('a sandbox PDF click stays in-app and opens the resolved file', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { default: MarkdownRendererImpl } = await import('./MarkdownRendererImpl')
    const { registerInspectorHandler } = await import('@/shared/lib/inspectorBus')
    const requests: unknown[] = []
    const stop = registerInspectorHandler((request) => requests.push(request))
    const fileName =
      '\u041f\u043b\u0430\u043d_\u0442\u0440\u0435\u043d\u0438\u0440\u043e\u0432\u043e\u043a_' +
      '\u0434\u043b\u044f_\u043f\u043e\u0445\u0443\u0434\u0435\u043d\u0438\u044f_4_' +
      '\u043d\u0435\u0434\u0435\u043b\u0438.pdf'
    const label =
      '\u0421\u043a\u0430\u0447\u0430\u0442\u044c PDF-\u043f\u043b\u0430\u043d ' +
      '\u0442\u0440\u0435\u043d\u0438\u0440\u043e\u0432\u043e\u043a'
    const path = `/Users/dev/.localix/workspace/LOCALIX-7/${fileName}`
    const href = `sandbox:${path}`

    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <WorkItemSessionProvider sessionId="s1">
          <MarkdownRendererImpl>{`[${label}](${href})`}</MarkdownRendererImpl>
        </WorkItemSessionProvider>,
      ),
    )

    const link = host.querySelector<HTMLAnchorElement>('a')
    expect(decodeURIComponent(link?.getAttribute('href') ?? '')).toBe(href)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    await act(async () => {
      link?.dispatchEvent(click)
    })

    // This preventDefault is the route-safety invariant: without it the webview
    // follows the anchor and the hash router lands on a fresh empty chat.
    expect(click.defaultPrevented).toBe(true)
    expect(requests.at(-1)).toEqual({ kind: 'file', sessionId: 's1', path, line: undefined })

    await act(async () => root.unmount())
    stop()
  })

  test('external links leave through the platform opener, never webview navigation', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { default: MarkdownRendererImpl } = await import('./MarkdownRendererImpl')
    const { configurePlatformCapabilities } = await import('@/shared/lib/platformCapabilities')
    const opened: string[] = []
    const restore = configurePlatformCapabilities({ external: { open: (url) => opened.push(url) } })

    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <MarkdownRendererImpl>{'[Documentation](https://example.com/docs)'}</MarkdownRendererImpl>,
      ),
    )

    const link = host.querySelector<HTMLAnchorElement>('a')
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    await act(async () => {
      link?.dispatchEvent(click)
    })
    expect(click.defaultPrevented).toBe(true)
    expect(opened).toEqual(['https://example.com/docs'])

    await act(async () => root.unmount())
    restore()
  })

  test('unsafe and hash-router links render inert instead of navigating', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { default: MarkdownRendererImpl } = await import('./MarkdownRendererImpl')
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () =>
      root.render(
        <MarkdownRendererImpl>
          {'[unsafe](javascript:alert(1)) and [route-breaking](#fresh-chat)'}
        </MarkdownRendererImpl>,
      ),
    )

    expect(host.querySelector('a')).toBeNull()
    expect(host.textContent).toContain('unsafe')
    expect(host.textContent).toContain('route-breaking')

    await act(async () => root.unmount())
  })
})
