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

/** next-steps' band: three suggestions on 1, 2 and 3, and dismiss on 0. */
const band: ModElement[] = [
  {
    type: 'Box',
    props: { flexDirection: 'column' },
    children: [
      { type: 'Text', props: { dimColor: true }, children: ['next:'] },
      ...['Run the tests', 'Commit', 'Open a PR'].map((label, index): ModElement => ({
        type: 'Button',
        props: { key: `s${index}`, label, hotkey: String(index + 1), plain: true },
        children: [],
      })),
      { type: 'Button', props: { key: 'dismiss', label: 'dismiss', hotkey: '0' }, children: [] },
    ],
  },
]

async function mount() {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ModBand } = await import('./ModBand')
  const actions: ModAction[] = []
  // The composer's shell: the band sits above its text field, as in the composer.
  const shell = document.createElement('div')
  shell.setAttribute('data-agent-link-drop-target', '')
  const slot = document.createElement('div')
  const field = document.createElement('textarea')
  shell.append(slot, field)
  document.body.append(shell)
  const root = createRoot(slot)
  await act(async () =>
    root.render(
      <ModBand
        tree={band}
        act={(action) => actions.push(action)}
        // No pause in a test: the digit is still alone in the box when the band looks.
        afterPause={(run) => (run(), () => {})}
      />,
    ),
  )
  const type = async (value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        field,
        value,
      )
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  const done = async () => {
    await act(async () => root.unmount())
    shell.remove()
  }
  return { act, slot, field, actions, type, done }
}

test('the band draws the mods’ tree; a hotkey presses its Button while the band has focus', async () => {
  const { act, slot, actions, done } = await mount()
  expect(slot.textContent).toContain('next:')
  expect(slot.textContent).toContain('Run the tests')
  const region = slot.querySelector<HTMLElement>('[role="region"]')!
  region.focus()
  await act(async () => {
    region.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }))
  })
  expect(actions).toEqual([{ kind: 'press', element: 's1' }])
  await done()
})

test('a digit typed alone into the empty prompt presses the band’s Button, and leaves the box empty', async () => {
  const { field, actions, type, done } = await mount()
  await type('3')
  expect(actions).toEqual([{ kind: 'press', element: 's2' }])
  expect(field.value).toBe('')
  // A digit that starts a prompt is the person's.
  await type('3 files')
  await type('9')
  expect(actions).toHaveLength(1)
  expect(field.value).toBe('9')
  await done()
})

test('collapsed, the band hides its tree and no hotkey presses in it', async () => {
  const { act, slot, actions, type, done } = await mount()
  const collapse = slot.querySelector<HTMLButtonElement>('button[aria-label="Collapse the band"]')!
  await act(async () => collapse.click())
  expect(slot.textContent).not.toContain('Run the tests')
  await type('1')
  expect(actions).toEqual([])
  const expand = slot.querySelector<HTMLButtonElement>('button[aria-label="Expand the band"]')!
  await act(async () => expand.click())
  expect(slot.textContent).toContain('Run the tests')
  await done()
})
