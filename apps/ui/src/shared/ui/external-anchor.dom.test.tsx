import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('ExternalAnchor', () => {
  test('keeps link semantics while routing primary and middle activation through the host', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { configurePlatformCapabilities } = await import('@/shared/lib/platformCapabilities')
    const { ExternalAnchor } = await import('./external-anchor')
    const opened: Array<{ url: string; systemBrowser?: boolean }> = []
    const restore = configurePlatformCapabilities({
      external: { open: (url, systemBrowser) => opened.push({ url, systemBrowser }) },
    })
    const host = document.createElement('div')
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(<ExternalAnchor href="https://example.com/docs">Documentation</ExternalAnchor>),
      )
      const link = host.querySelector<HTMLAnchorElement>('a')!
      expect(link.getAttribute('data-slot')).toBe('external-anchor')
      expect(link.getAttribute('href')).toBe('https://example.com/docs')
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')

      const click = new MouseEvent('click', { bubbles: true, cancelable: true })
      await act(async () => link.dispatchEvent(click))
      expect(click.defaultPrevented).toBe(true)

      const middle = new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true })
      await act(async () => link.dispatchEvent(middle))
      expect(middle.defaultPrevented).toBe(true)
      expect(opened).toEqual([
        { url: 'https://example.com/docs', systemBrowser: false },
        { url: 'https://example.com/docs', systemBrowser: false },
      ])
      await act(async () =>
        root.render(
          <ExternalAnchor href="https://example.com/oauth" systemBrowser>
            Sign in
          </ExternalAnchor>,
        ),
      )
      await act(async () => host.querySelector<HTMLAnchorElement>('a')!.click())
      expect(opened.at(-1)).toEqual({ url: 'https://example.com/oauth', systemBrowser: true })
      expect(host.querySelector('a')!.hasAttribute('systemBrowser')).toBe(false)
    } finally {
      await act(async () => root.unmount())
      host.remove()
      restore()
    }
  })

  test('honours caller cancellation and supports protocol-handler semantics', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { configurePlatformCapabilities } = await import('@/shared/lib/platformCapabilities')
    const { ExternalAnchor } = await import('./external-anchor')
    const opened: string[] = []
    const restore = configurePlatformCapabilities({ external: { open: (url) => opened.push(url) } })
    const host = document.createElement('div')
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <ExternalAnchor
            href="mailto:hello@example.com"
            newTab={false}
            onClick={(event) => event.preventDefault()}
          >
            Email
          </ExternalAnchor>,
        ),
      )
      const link = host.querySelector<HTMLAnchorElement>('a')!
      expect(link.getAttribute('target')).toBeNull()
      expect(link.getAttribute('rel')).toBeNull()
      await act(async () => link.click())
      expect(opened).toHaveLength(0)
    } finally {
      await act(async () => root.unmount())
      host.remove()
      restore()
    }
  })
})
