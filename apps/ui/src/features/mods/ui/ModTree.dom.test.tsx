import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ModAction, ModElement } from '@/shared/api/modsApi'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

const tree: ModElement[] = [
  {
    type: 'Box',
    props: { flexDirection: 'column', gap: 1 },
    children: [
      { type: 'Text', props: { bold: true }, children: ['Calls: ', '3'] },
      { type: 'Button', props: { key: 'reset', label: 'Reset' }, children: [] },
      { type: 'Input', props: { key: 'note', placeholder: 'A note' }, children: [] },
      { type: 'Link', props: { href: 'javascript:alert(1)', label: 'Sneaky' }, children: [] },
      { type: 'Svg', props: { source: '<svg><circle r="1"/></svg>', alt: 'A dot' }, children: [] },
    ],
  },
]

test('a mod’s drawing renders with kit controls and sends what the person does', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ModTree } = await import('./ModTree')
  const actions: ModAction[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(<ModTree nodes={tree} act={(action) => actions.push(action)} />),
  )

  expect(host.textContent).toContain('Calls: 3')
  expect(host.querySelector('span')?.className).toContain('font-semibold')
  expect(host.querySelector('a')).toBeNull()
  expect(host.textContent).toContain('Sneaky')
  const svg = host.querySelector('img')!
  expect(svg.alt).toBe('A dot')
  expect(svg.src.startsWith('data:image/svg+xml')).toBe(true)

  const button = [...host.querySelectorAll('button')].find((node) => node.textContent === 'Reset')!
  await act(async () => button.click())
  expect(actions).toEqual([{ kind: 'press', element: 'reset' }])

  const field = host.querySelector('input')!
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(field, 'milk')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    field.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  expect(actions.at(-1)).toEqual({ kind: 'submit', element: 'note', value: 'milk' })

  await act(async () => root.unmount())
  host.remove()
})
