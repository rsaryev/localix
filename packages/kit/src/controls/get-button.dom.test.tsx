import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

async function render(node: React.ReactNode) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => root.render(node))
  return {
    host,
    rerender: (next: React.ReactNode) => React.act(async () => root.render(next)),
    done: async () => {
      await React.act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('GetButton', () => {
  test('one control walks Get → progress → Open, each step named for what it acts on', async () => {
    const { GetButton } = await import('./get-button')
    const pressed: string[] = []
    const view = await render(
      <GetButton name="Chess" state={{ kind: 'get' }} onPress={() => pressed.push('get')} />,
    )
    const button = () => view.host.querySelector('button')
    expect(button()?.getAttribute('aria-label')).toBe('Get Chess')
    expect(button()?.textContent).toBe('Get')
    button()!.click()
    expect(pressed).toEqual(['get'])

    await view.rerender(
      <GetButton name="Chess" state={{ kind: 'progress', percent: 42, label: 'Installing' }} />,
    )
    const bar = view.host.querySelector('[role="progressbar"]')
    expect(bar?.getAttribute('aria-label')).toBe('Installing Chess')
    expect(bar?.getAttribute('aria-valuenow')).toBe('42')
    expect(view.host.textContent).toContain('42%')
    expect(button()).toBeNull()

    await view.rerender(
      <GetButton name="Chess" state={{ kind: 'progress', percent: null, label: 'Waiting' }} />,
    )
    expect(view.host.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(
      false,
    )

    await view.rerender(<GetButton name="Chess" state={{ kind: 'open' }} onPress={() => {}} />)
    expect(button()?.getAttribute('aria-label')).toBe('Open Chess')
    await view.done()
  })

  test('Update, Retry, and an install that has nothing to open says so without a button', async () => {
    const { GetButton } = await import('./get-button')
    const view = await render(
      <GetButton name="Git" state={{ kind: 'update' }} onPress={() => {}} />,
    )
    expect(view.host.querySelector('button')?.getAttribute('aria-label')).toBe('Update Git')
    await view.rerender(<GetButton name="Git" state={{ kind: 'retry' }} onPress={() => {}} />)
    expect(view.host.querySelector('button')?.getAttribute('aria-label')).toBe('Retry Git')
    await view.rerender(<GetButton name="Git" state={{ kind: 'installed' }} />)
    expect(view.host.querySelector('button')).toBeNull()
    expect(view.host.textContent).toBe('Installed')
    await view.done()
  })
})
