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

/** A made-up mod's band: a labelled list of three picks on 1, 2 and 3, and dismiss on 0. */
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
      {
        type: 'Button',
        props: { key: 'dismiss', label: 'dismiss', hotkey: '0', plain: true },
        children: [],
      },
    ],
  },
]

async function mount(tree: ModElement[] = band) {
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
        tree={tree}
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

test('a list of picks reads as one row of chips, each with its key, after its label', async () => {
  const { act, slot, actions, done } = await mount()
  const row = slot.querySelector('[role="group"][aria-label="Mods band choices"]')!
  const chips = [...row.querySelectorAll('button')]
  expect(chips.map((chip) => chip.textContent)).toEqual([
    'Run the tests1',
    'Commit2',
    'Open a PR3',
    'dismiss0',
  ])
  expect(chips.map((chip) => chip.getAttribute('aria-keyshortcuts'))).toEqual(['1', '2', '3', '0'])
  // The label sits beside the row, not as a heading over a list.
  expect(row.parentElement!.textContent!.startsWith('next:')).toBe(true)
  // ← and → walk the chips.
  await act(async () => chips[0]!.focus())
  await act(async () => {
    chips[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  })
  expect(document.activeElement).toBe(chips[1]!)
  await act(async () => chips[3]!.click())
  expect(actions).toEqual([{ kind: 'press', element: 'dismiss' }])
  await done()
})

test('collapsed, the band is one row of what it says, and no hotkey presses in it', async () => {
  const { act, slot, actions, type, done } = await mount()
  const collapse = slot.querySelector<HTMLButtonElement>('button[aria-label="Collapse the band"]')!
  await act(async () => collapse.click())
  expect(slot.querySelector('[aria-keyshortcuts]')).toBeNull()
  const summary = slot.querySelector('[role="group"][aria-label="Mods band, collapsed"]')!
  expect(summary.textContent).toBe('next: Run the tests Commit Open a PR dismiss')
  await type('1')
  expect(actions).toEqual([])
  // A part of the summary opens the band again.
  await act(async () => summary.querySelector('button')!.click())
  expect(slot.querySelectorAll('[aria-keyshortcuts]')).toHaveLength(4)
  await done()
})

/** A second made-up mod's status line beside its button, above the first one's picks. */
const status: ModElement = {
  type: 'Box',
  props: { flexDirection: 'row', gap: 2, paddingX: 1 },
  children: [
    { type: 'Text', props: { color: 'magenta', bold: true }, children: ['▶ Status: 1 change'] },
    { type: 'Button', props: { key: 'open', label: 'Open', hotkey: 'o' }, children: [] },
  ],
}

test('the band is part of the composer: its surface, one hairline, a quiet collapse control', async () => {
  const { slot, done } = await mount([status, ...band])
  const strip = slot.firstElementChild as HTMLElement
  // No stripe of its own: the composer's surface shows through.
  expect(strip.className).not.toMatch(/\bbg-/)
  // One hairline between the band and the input, inset to the composer's padding.
  const seam = strip.querySelector<HTMLElement>('[data-slot="mods-band-seam"]')!
  expect(seam.className).toContain('border-b')
  expect(seam.className).toContain('border-border-faint')
  const collapse = slot.querySelector<HTMLButtonElement>('button[aria-label="Collapse the band"]')!
  expect(collapse.dataset.variant).toBe('ghost')
  await done()
})

test('one button style: the line’s button and the picks are quiet ghost actions with keycaps', async () => {
  const { act, slot, done } = await mount([status, ...band])
  const buttons = [...slot.querySelectorAll<HTMLButtonElement>('button[aria-keyshortcuts]')]
  expect(buttons.map((button) => button.dataset.variant)).toEqual(Array(5).fill('ghost'))
  expect(buttons.map((button) => button.querySelector('kbd')?.textContent)).toEqual([
    'o',
    '1',
    '2',
    '3',
    '0',
  ])
  // A pick's label truncates in its chip; the whole of it is in the tooltip.
  const pick = buttons[1]!
  expect(pick.getAttribute('title')).toBeNull()
  await act(async () => {
    pick.focus()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  const tooltip = document.body.querySelector<HTMLElement>('[role="tooltip"]')!
  expect(tooltip.textContent).toContain('Run the tests')
  await act(async () => {
    pick.blur()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await done()
})
