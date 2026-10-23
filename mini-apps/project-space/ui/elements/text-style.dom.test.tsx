import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { spaceTypes } from '../../shared/types'
import type { ElementViewProps } from './contract'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

const base: Omit<ElementViewProps, 'props'> = {
  id: 'note',
  width: 240,
  height: 200,
  selected: true,
  editing: false,
  missing: false,
  sessionId: 'board-chat',
  stamp: 0,
  commit: () => {},
  resize: () => {},
  stopEditing: () => {},
}

async function mount(node: React.ReactNode) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(node))
  return {
    host,
    act,
    rerender: (next: React.ReactNode) => act(async () => root.render(next)),
    unmount: () => act(async () => root.unmount()).then(() => host.remove()),
  }
}

const noteProps = (props: Record<string, unknown>) => {
  const read = spaceTypes.read('note', props, 2)
  if (read.status !== 'ok') throw new Error('note props rejected')
  return read.props
}

test('a note draws its marks, lists and face, and a ticked task is one edit of its text', async () => {
  const { drawingViews } = await import('./drawing')
  const View = drawingViews.find((view) => view.type === 'note')!.View
  const commits: Record<string, unknown>[] = []
  const text = '# Launch\n**Ship** the *beta*\n- [ ] tests\n- docs'
  const view = await mount(
    <View
      {...base}
      props={noteProps({ text, font: 'serif', align: 'center' })}
      commit={(next) => commits.push(next)}
    />,
  )
  try {
    expect(view.host.querySelector('[role="heading"]')?.textContent).toBe('Launch')
    expect(view.host.querySelector('strong')?.textContent).toBe('Ship')
    expect(view.host.querySelector('em')?.textContent).toBe('beta')
    expect(view.host.querySelector('.space-font-serif.text-center')).not.toBeNull()
    expect(view.host.textContent).not.toContain('**')

    // A click on the words is a click on the note, never a tick.
    const words = [...view.host.querySelectorAll('span')].find(
      (node) => node.textContent === 'tests',
    )!
    await view.act(async () => words.click())
    expect(commits).toEqual([])

    const box = view.host.querySelector<HTMLInputElement>('input[aria-label="tests"]')!
    await view.act(async () => box.click())
    expect(commits).toEqual([{ text: '# Launch\n**Ship** the *beta*\n- [x] tests\n- docs' }])
  } finally {
    await view.unmount()
  }
})

test('format keys wrap the selection in marks, and Enter continues a list', async () => {
  const { InlineText } = await import('./InlineText')
  let committed = ''
  const view = await mount(
    <InlineText
      value="ship it"
      onCommit={(value) => (committed = value)}
      onDone={() => {}}
      formatting
    />,
  )
  try {
    const field = view.host.querySelector('textarea')!
    const press = (key: string, init: KeyboardEventInit = {}) =>
      view.act(async () => {
        field.dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
        )
      })
    const { isPrimaryModifier } = await import('@localixai/kit/keybindings')
    const mod = isPrimaryModifier({ metaKey: true, ctrlKey: false } as KeyboardEvent)
      ? { metaKey: true }
      : { ctrlKey: true }
    field.setSelectionRange(5, 7)
    await press('b', mod)
    expect(field.value).toBe('ship **it**')
    expect([field.selectionStart, field.selectionEnd]).toEqual([5, 11])
    await press('b', mod)
    expect(field.value).toBe('ship it')

    await view.act(async () => {
      field.value = '- one'
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    field.setSelectionRange(5, 5)
    await press('Enter')
    expect(field.value).toBe('- one\n- ')

    await view.act(async () => field.blur())
    expect(committed).toBe('- one\n- ')
  } finally {
    await view.unmount()
  }
})

test("the bar gathers a type's text settings into one Text menu", async () => {
  const { barControls } = await import('../board/SelectionBar')
  const { viewOf } = await import('./index')
  const controlsOf = (type: string) => viewOf(type)?.controls ?? []

  const note = barControls([controlsOf('note')])
  expect(note.controls.map((control) => control.prop)).toEqual(['color'])
  expect(note.textControls.map((control) => control.prop)).toEqual([
    'font',
    'size',
    'align',
    'valign',
  ])
  // A note and a shape share their face and place, not the shape's kind or the note's fit.
  const mixed = barControls([controlsOf('note'), controlsOf('shape')])
  expect(mixed.textControls.map((control) => control.prop)).toEqual(['font', 'align', 'valign'])
  expect(mixed.controls.map((control) => control.prop)).toEqual(['color'])

  const { StyleMenu } = await import('../board/pickers')
  const { Type } = await import('lucide-react')
  const picks: [string, string | null][] = []
  const view = await mount(
    <StyleMenu
      label="Text"
      Icon={Type}
      controls={note.textControls}
      valueOf={(prop) => ({ font: 'sans', size: 'auto', align: 'start', valign: 'top' })[prop]}
      onPick={(prop, value) => picks.push([prop, value])}
    />,
  )
  try {
    const trigger = view.host.querySelector<HTMLButtonElement>('button[aria-label="Text"]')!
    expect(trigger).not.toBeNull()
    await view.act(async () => {
      trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    })
    const rows = [...document.querySelectorAll('[role="menuitem"]')].map((row) => row.textContent)
    expect(rows.join(' | ')).toContain('Font')
    expect(rows.join(' | ')).toContain('Fit to note')
  } finally {
    await view.unmount()
  }
})

test('an empty value is a choice of its own, never "mixed"', async () => {
  const { sharedValue } = await import('../board/SelectionBar')
  // A snippet in "Plain text" has language ''; it was read as no value and shown as mixed.
  expect(sharedValue([{ language: '' }, { language: '' }], 'language')).toBe('')
  expect(sharedValue([{ language: 'ts' }, { language: '' }], 'language')).toBeUndefined()
  expect(sharedValue([{ color: 'red' }], 'color')).toBe('red')
})
