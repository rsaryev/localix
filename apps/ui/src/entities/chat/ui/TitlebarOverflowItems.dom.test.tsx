import { afterAll, beforeAll, expect, test } from 'bun:test'
import type { StatusItemContribution } from '@localixai/plugin-sdk/ui'
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

/**
 * The titlebar's `…` menu is the ONLY place a contributed item is rendered outside the strip's own
 * per-item boundary, and it is reached by a click rather than by paint — so a plugin that throws
 * here used to unwind past the whole workbench to the route's `errorElement`. From the user's
 * chair: the window is replaced by a crash screen (titlebar, plugin glyphs and the event bell with
 * it) and the journal gains a "Route failed" row carrying a raw minified React message. Whether an
 * item fits is a layout accident; it must not decide whether one broken plugin costs a glyph or a
 * route.
 */
test('a plugin that throws inside the “…” menu costs its own row, never the route', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { TitlebarOverflowItems } = await import('./TitlebarOverflowItems')
  const { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } =
    await import('@localixai/kit/dropdown-menu')

  const items: StatusItemContribution[] = [
    {
      id: 'overflow:healthy',
      pluginName: 'healthy',
      placement: 'titlebar',
      useItem: () => ({ label: 'Still here', onClick: () => undefined }),
    },
    {
      id: 'overflow:broken',
      pluginName: 'broken',
      placement: 'titlebar',
      useItem: () => {
        throw new Error('boom in an overflow row')
      },
    },
  ]

  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <DropdownMenu open>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="More plugin items" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <TitlebarOverflowItems items={items} sessionId="s1" />
          </DropdownMenuContent>
        </DropdownMenu>,
      ),
    )

    // Rendering at all is half the assertion: without the boundary the throw escapes `render`.
    expect(document.body.textContent).toContain('Still here')
    expect(document.body.textContent).not.toContain('boom in an overflow row')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
