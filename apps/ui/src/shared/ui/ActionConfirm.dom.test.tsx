import { afterAll, beforeAll, expect, test } from 'bun:test'
import { createRequire } from 'node:module'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

test('drawer and confirmation share one modal and focus-scope registry', () => {
  const require = createRequire(import.meta.url)
  const drawer = createRequire(require.resolve('vaul'))
  const confirmation = createRequire(require.resolve('radix-ui'))
  const drawerDialog = createRequire(drawer.resolve('@radix-ui/react-dialog'))
  const confirmDialog = createRequire(confirmation.resolve('@radix-ui/react-dialog'))
  for (const module of ['@radix-ui/react-dismissable-layer', '@radix-ui/react-focus-scope']) {
    expect(drawerDialog.resolve(module)).toBe(confirmDialog.resolve(module))
  }
})

test('declining an external link inside a drawer releases all modal input locks', async () => {
  const { act, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Drawer, DrawerContent, DrawerTitle } = await import('@localixai/kit/drawer')
  const { Button } = await import('@localixai/kit/button')
  const { ActionConfirm } = await import('./ActionConfirm')
  const { requestConfirmation, resetConfirmationsForTests } =
    await import('@/shared/lib/confirmAction')
  let performed = 0
  let clicks = 0
  function Host() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <Button onClick={() => setOpen(true)}>Choose provider</Button>
        <Button onClick={() => clicks++}>Workspace action</Button>
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent>
            <DrawerTitle>Connections</DrawerTitle>
            <Button
              onClick={() =>
                requestConfirmation({
                  kind: 'external-link',
                  title: 'Open provider sign-in?',
                  perform: () => performed++,
                })
              }
            >
              Sign in
            </Button>
            <Button onClick={() => setOpen(false)}>Close connections</Button>
          </DrawerContent>
        </Drawer>
        <ActionConfirm />
      </>
    )
  }
  // Happy DOM does not finish CSS animations; keep this test focused on modal ownership.
  const style = document.createElement('style')
  style.textContent = '[data-vaul-drawer], [data-vaul-overlay] { animation-name: none !important; }'
  document.head.append(style)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const button = (label: string) => {
    const found = Array.from(document.querySelectorAll('button')).find(
      (node) => node.textContent === label,
    )
    if (!found) throw new Error(`Missing button: ${label}`)
    return found
  }
  const click = async (label: string) => act(async () => button(label).click())
  const wait = async () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600))
    })
  try {
    await act(async () => root.render(<Host />))
    for (let attempt = 0; attempt < 2; attempt++) {
      await click('Choose provider')
      await wait()
      await click('Sign in')
      await click('Cancel')
      await wait()
      expect(document.querySelector('[role="alertdialog"]')).toBeNull()
      expect(getComputedStyle(button('Sign in')).pointerEvents).not.toBe('none')
      await click('Close connections')
      await wait()
      expect(document.querySelector('[data-slot="drawer-content"]') === null).toBe(true)
      expect(document.body.style.pointerEvents).not.toBe('none')
      await click('Workspace action')
    }
    expect(clicks).toBe(2)
    expect(performed).toBe(0)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    style.remove()
    resetConfirmationsForTests()
  }
}, 10_000)
