import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test'
import { act, createRef, type ReactNode } from 'react'
import { useFocusStack, type FocusKind } from '@localixai/plugin-sdk/ui/focus'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})
beforeEach(() => useFocusStack.getState().reset())

const claims = () => useFocusStack.getState().entries.map((entry) => entry.kind)

/**
 * A closing overlay stays mounted until its exit animation ends, and the claim lasts exactly as
 * long. Vaul injects real keyframes, and Happy DOM never runs them, so play the end of each one.
 */
async function settled(): Promise<FocusKind[]> {
  await act(async () => {
    for (const node of document.body.querySelectorAll<HTMLElement>('[data-state="closed"]')) {
      const animationName = getComputedStyle(node).animationName
      if (!animationName || animationName === 'none') continue
      const end = new Event('animationend', { bubbles: true })
      Object.defineProperty(end, 'animationName', { value: animationName })
      node.dispatchEvent(end)
    }
  })
  return claims()
}

async function mount(render: (open: boolean) => ReactNode) {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  return {
    show: (open: boolean) => act(async () => root.render(render(open))),
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

// The regression: every wrapper below used to claim while merely RENDERED, which a closed overlay
// is. One closed picker left a permanent `dialog` on the stack, so the desktop browser page saw an
// overlay that nobody could see, and kept yielding to it.
test('a closed overlay makes no claim; an open one claims until it closes', async () => {
  const { Dialog, DialogContent, DialogTitle } = await import('./dialog')
  const { Drawer, DrawerContent, DrawerTitle } = await import('./drawer')
  const { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } = await import('./dropdown-menu')
  const { Popover, PopoverContent, PopoverTrigger } = await import('./popover')
  const { ConfirmDialog } = await import('./confirm-dialog')
  const cases: Array<[string, (open: boolean) => ReactNode, FocusKind]> = [
    [
      'dialog',
      (open) => (
        <Dialog open={open}>
          <DialogContent>
            <DialogTitle>Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      ),
      'dialog',
    ],
    [
      'drawer',
      (open) => (
        <Drawer open={open} onOpenChange={() => {}}>
          <DrawerContent>
            <DrawerTitle>Drawer</DrawerTitle>
          </DrawerContent>
        </Drawer>
      ),
      'dialog',
    ],
    [
      'dropdown menu',
      (open) => (
        <DropdownMenu open={open}>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>Items</DropdownMenuContent>
        </DropdownMenu>
      ),
      'menu',
    ],
    [
      'popover',
      (open) => (
        <Popover open={open}>
          <PopoverTrigger>Popover</PopoverTrigger>
          <PopoverContent>Body</PopoverContent>
        </Popover>
      ),
      'menu',
    ],
    [
      'confirm dialog',
      (open) => <ConfirmDialog open={open} title="Sure?" onConfirm={() => {}} onClose={() => {}} />,
      'dialog',
    ],
  ]
  for (const [name, render, kind] of cases) {
    const view = await mount(render)
    try {
      await view.show(false)
      expect({ name, claims: claims() }).toEqual({ name, claims: [] })
      await view.show(true)
      expect({ name, claims: claims() }).toEqual({ name, claims: [kind] })
      await view.show(false)
      expect({ name, claims: await settled() }).toEqual({ name, claims: [] })
    } finally {
      await view.unmount()
    }
  }
})

test('the claim ref still hands the caller its own ref to the content element', async () => {
  const { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } = await import('./dropdown-menu')
  const contentRef = createRef<HTMLDivElement>()
  const view = await mount((open) => (
    <DropdownMenu open={open}>
      <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
      <DropdownMenuContent ref={contentRef}>Items</DropdownMenuContent>
    </DropdownMenu>
  ))
  try {
    await view.show(true)
    expect(contentRef.current?.getAttribute('role')).toBe('menu')
    await view.show(false)
    expect(contentRef.current).toBeNull()
  } finally {
    await view.unmount()
  }
})
