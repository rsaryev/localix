import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import type { LspDocumentSymbol } from '@/shared/api/contracts'
import { SymbolBreadcrumbBar } from './SymbolBreadcrumbBar'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

test('file menu reaches nested symbols outside any scope, and child menu jumps to a method', async () => {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const outer: LspDocumentSymbol = {
    name: 'Service',
    kind: 5,
    line: 2,
    character: 0,
    endLine: 20,
    depth: 0,
  }
  const method: LspDocumentSymbol = {
    name: 'run',
    kind: 6,
    line: 4,
    character: 2,
    endLine: 10,
    depth: 1,
  }
  const jumps: number[] = []
  const render = (path: LspDocumentSymbol[]) =>
    act(async () =>
      root.render(
        <SymbolBreadcrumbBar
          fileName="service.py"
          docSymbols={[outer, method]}
          symbolPath={path}
          onJump={(line) => jumps.push(line)}
        />,
      ),
    )
  const open = async (label: string) => {
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
        .dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
        )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    return document.body.querySelector<HTMLElement>('[role="menu"]')!
  }
  try {
    await render([])
    const fileMenu = await open('Browse symbols in service.py')
    expect(fileMenu.textContent).toContain('Service')
    expect(fileMenu.textContent).toContain('run')
    expect(fileMenu.textContent).toContain('L5')
    await act(async () => fileMenu.querySelectorAll<HTMLElement>('[role="menuitem"]')[1]!.click())
    expect(jumps).toEqual([4])
    await render([outer])
    const childMenu = await open('Browse children of Service')
    expect(childMenu.textContent).toContain('run')
    expect(childMenu.textContent).not.toContain('Service')
    await act(async () => childMenu.querySelector<HTMLElement>('[role="menuitem"]')!.click())
    expect(jumps).toEqual([4, 4])
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Go to Service"]')!.click(),
    )
    expect(jumps).toEqual([4, 4, 2])
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
