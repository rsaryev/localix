import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { ProjectFolderMenu } from './ProjectFolderMenu'
import type { Project } from '@/shared/api/contracts'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

test('the shared folder menu puts Add folder first and delegates a selected project to its owner', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const projects = [
    { id: 'a', name: 'First', workingDir: '/demo/first' },
    { id: 'b', name: 'Second', workingDir: '/demo/second' },
  ] as Project[]
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const calls: string[] = []
  try {
    await React.act(async () =>
      root.render(
        <ProjectFolderMenu
          projects={projects}
          activeProjectId="a"
          onAddFolder={() => calls.push('add')}
          onPick={(id) => calls.push(id)}
        />,
      ),
    )
    const trigger = host.querySelector('button')!
    expect(trigger.getAttribute('aria-label')).toBe('Project: First')
    await React.act(async () =>
      trigger.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
      ),
    )
    const menu = document.querySelector('[role="menu"]')!
    expect(menu.querySelector('[role="menuitem"]')?.textContent).toBe('Add folder…')
    const rows = [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
    expect(rows[0]!.getAttribute('aria-checked')).toBe('true')
    await React.act(async () => rows[1]!.click())
    expect(calls).toEqual(['b'])
  } finally {
    await React.act(async () => root.unmount())
    host.remove()
  }
})
