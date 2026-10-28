import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { RailEntry } from './shellTypes'
import { turns } from '@/testing/settle'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const entry = (id: string, onClick: () => void, active = false): RailEntry => ({
  id,
  label: id,
  miniApp: true,
  miniAppName: id,
  active,
  icon: <span />,
  onClick,
})

test('one or two pins stay direct; three combine, and unpinning dissolves the group', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { RailToolGroups } = await import('./RailToolGroups')
  const opens: string[] = []
  const entries = [
    entry('Git', () => opens.push('Git')),
    entry('Reader', () => opens.push('Reader'), true),
    entry('Database', () => opens.push('Database')),
    entry('Chess', () => opens.push('Chess')),
  ]
  const categories = new Map<string, 'development' | 'content' | 'data' | 'games'>([
    ['Git', 'development'],
    ['Reader', 'content'],
    ['Database', 'data'],
    ['Chess', 'games'],
  ])
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const paint = (pins: RailEntry[]) =>
    React.act(async () =>
      root.render(
        <RailToolGroups
          entries={pins}
          categories={categories}
          renderEntry={(item) => (
            <button key={item.id} onClick={() => item.onClick()}>
              {item.label}
            </button>
          )}
        />,
      ),
    )
  try {
    await paint(entries.slice(0, 2))
    expect([...host.querySelectorAll('button')].map((item) => item.textContent)).toEqual([
      'Git',
      'Reader',
    ])
    await React.act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
    expect(opens).toEqual(['Git'])
    await paint(entries)
    const group = host.querySelector<HTMLButtonElement>('[aria-label="Workspace"]')!
    expect(group.getAttribute('aria-current')).toBe('true')
    expect(host.querySelectorAll('[data-rail-category]')).toHaveLength(1)
    expect(host.textContent).toContain('Chess')
    await React.act(async () => {
      group.focus()
      group.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await turns(3)
    })
    const rows = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
    expect(rows.map((row) => row.textContent)).toEqual(['Git', 'Reader', 'Database'])
    expect(rows[1]?.getAttribute('aria-checked')).toBe('true')
    await React.act(async () => rows[2]!.click())
    expect(opens).toEqual(['Git', 'Database'])
    await paint(entries.filter((item) => item.id !== 'Database'))
    expect(host.querySelector('[data-rail-category]')).toBeNull()
    expect([...host.querySelectorAll('button')].map((item) => item.textContent)).toEqual([
      'Git',
      'Reader',
      'Chess',
    ])
  } finally {
    await React.act(async () => root.unmount())
    host.remove()
  }
})
