import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await teardown()
})

describe('PopoverContent layout ownership', () => {
  test('moves scrolling from the shell to the one structured body', async () => {
    const { createRoot } = await import('react-dom/client')
    const { Popover, PopoverBody, PopoverContent, PopoverFooter, PopoverHeader, PopoverTrigger } =
      await import('./popover')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <Popover open>
            <PopoverTrigger>Open</PopoverTrigger>
            <PopoverContent layout="structured">
              <PopoverHeader>Context</PopoverHeader>
              <PopoverBody>Scrollable work</PopoverBody>
              <PopoverFooter>Actions</PopoverFooter>
            </PopoverContent>
          </Popover>,
        ),
      )

      const content = document.body.querySelector<HTMLElement>('[data-slot="popover-content"]')!
      const body = content.querySelector<HTMLElement>('[data-slot="popover-body"]')!
      expect(content.dataset.layout).toBe('structured')
      expect(content.classList).toContain('overflow-hidden')
      expect(content.classList).not.toContain('overflow-y-auto')
      expect(body.classList).toContain('overflow-y-auto')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('forwards the content ref through the portal to the positioned surface', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { Popover, PopoverContent, PopoverTrigger } = await import('./popover')
    const contentRef = React.createRef<HTMLDivElement>()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <Popover open>
            <PopoverTrigger>Open</PopoverTrigger>
            <PopoverContent ref={contentRef}>Content</PopoverContent>
          </Popover>,
        ),
      )

      const content = document.body.querySelector<HTMLDivElement>('[data-slot="popover-content"]')
      expect(contentRef.current).toBe(content)
      expect(host.contains(content)).toBe(false)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('coordinate menus skip and visibly disable native disabled actions', async () => {
    const { createRoot } = await import('react-dom/client')
    const { CoordinateMenu, CoordinateMenuItem } = await import('./coordinate-menu')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <CoordinateMenu x={40} y={40} label="Canvas actions" onClose={() => undefined}>
            <CoordinateMenuItem disabled>Unavailable action</CoordinateMenuItem>
            <CoordinateMenuItem>Available action</CoordinateMenuItem>
          </CoordinateMenu>,
        ),
      )

      const items = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      expect(items).toHaveLength(2)
      expect(items[0]?.disabled).toBe(true)
      expect(items[0]?.classList).toContain('disabled:opacity-50')
      expect(document.activeElement).toBe(items[1])
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
