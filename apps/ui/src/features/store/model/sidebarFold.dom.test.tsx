import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { readFold } from './sidebarFold'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

function memory(initial?: string) {
  const data = new Map<string, string>(initial ? [['store:sidebar-folded', initial]] : [])
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  }
}

async function mountFold(storage: ReturnType<typeof memory>) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useSidebarFold } = await import('./sidebarFold')
  function Probe() {
    const { folded, toggle } = useSidebarFold(storage as unknown as Storage)
    return (
      <button type="button" onClick={toggle}>
        {folded ? 'icons' : 'full'}
      </button>
    )
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => root.render(<Probe />))
  const button = host.querySelector('button')!
  return {
    text: () => button.textContent,
    press: () => React.act(async () => button.click()),
    done: () => React.act(async () => root.unmount()),
  }
}

describe('sidebar fold', () => {
  test('it is open by default; the person’s fold is kept and can be undone', async () => {
    const storage = memory()
    const first = await mountFold(storage)
    expect(first.text()).toBe('full')
    await first.press()
    expect(first.text()).toBe('icons')
    await first.done()
    const again = await mountFold(storage)
    expect(again.text()).toBe('icons')
    await again.press()
    expect(again.text()).toBe('full')
    await again.done()
  })

  test('an unreadable store means no choice', () => {
    expect(
      readFold({
        getItem: () => {
          throw new Error('blocked')
        },
      }),
    ).toBeNull()
  })
})
