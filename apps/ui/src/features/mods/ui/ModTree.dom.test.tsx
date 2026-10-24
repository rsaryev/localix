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
  expect(host.querySelector('span')?.className).toContain('font-medium')
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

test('Claude Code’s control and text props draw: labels from children, hotkeys, rows, colours', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ModTree } = await import('./ModTree')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const nodes: ModElement[] = [
    {
      type: 'Button',
      props: { key: 'open', hotkey: 'r', autoFocus: true },
      children: ['Replay ', { type: 'Text', props: { dimColor: true }, children: ['2m'] }],
    },
    { type: 'Input', props: { key: 'note', rows: 4, label: 'Note' }, children: [] },
    { type: 'Select', props: { key: 'pick', label: 'Model', options: ['a'] }, children: [] },
    { type: 'Text', props: { color: 'green', strikethrough: true }, children: ['+1'] },
    { type: 'Text', props: { inverse: true }, children: [' 1 '] },
  ]
  await act(async () => root.render(<ModTree nodes={nodes} act={() => {}} />))
  const button = host.querySelector('button')!
  expect(button.textContent).toBe('Replay 2mr')
  expect(button.getAttribute('aria-keyshortcuts')).toBe('r')
  expect(button.hasAttribute('data-autofocus')).toBe(true)
  expect(host.querySelector('textarea')?.getAttribute('rows')).toBe('4')
  expect(host.textContent).toContain('Model')
  const added = [...host.querySelectorAll('span')].find((span) => span.textContent === '+1')!
  expect(added.className).toContain('line-through')
  // Spaces a mod draws between parts stay, as in a terminal.
  expect(added.style.whiteSpace).toBe('pre-wrap')
  expect(added.style.color).toBe('var(--status-success)')
  const inverse = [...host.querySelectorAll('span')].find((span) => span.textContent === ' 1 ')!
  // Inverse is a chip on a veil, not a block of reversed video.
  expect(inverse.style.backgroundColor).toBe('var(--surface-active)')
  await act(async () => root.unmount())
  host.remove()
})

async function render(nodes: ModElement[], site: 'band' | 'pane') {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ModTree } = await import('./ModTree')
  const { ModSiteContext } = await import('./modSite')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <ModSiteContext.Provider value={site}>
        <ModTree nodes={nodes} act={() => {}} />
      </ModSiteContext.Provider>,
    ),
  )
  const span = (text: string) =>
    [...host.querySelectorAll('span')].find((node) => node.textContent === text)!
  return {
    host,
    span,
    done: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

test('in a pane a mod’s text keeps its terminal grid; a coloured +/− line is a diff row', async () => {
  const { span, done } = await render(
    [
      { type: 'Text', props: {}, children: ['  context line'] },
      { type: 'Text', props: { color: 'green' }, children: ['+ added line'] },
      { type: 'Text', props: { color: 'red' }, children: ['- removed line'] },
      { type: 'Text', props: { color: 'green' }, children: ['+31'] },
      {
        type: 'Button',
        props: { key: 'next', hotkey: 'n' },
        children: [{ type: 'Text', props: {}, children: ['Next'] }],
      },
    ],
    'pane',
  )
  expect(span('  context line').className).toContain('font-mono')
  const added = span('+ added line')
  // The diff view's own row: its wash and gutter bar, the code in the text colour, the sign tinted.
  expect(added.className).toContain('bg-diff-added')
  expect(added.className).toContain('font-mono')
  expect(added.style.color).toBe('')
  expect(added.querySelector('span')!.className).toContain('text-status-success')
  expect(span('- removed line').className).toContain('bg-diff-removed')
  // A count stays a coloured word.
  expect(span('+31').className).not.toContain('bg-diff-added')
  expect(span('+31').style.color).toBe('var(--status-success)')
  // A button's label is the UI's own type.
  expect(span('Next').className).not.toContain('font-mono')
  await done()
})

test('in the band text is chrome: the UI face, a leading glyph faint, a named colour toned', async () => {
  const { span, done } = await render(
    [{ type: 'Text', props: { color: 'magenta', bold: true }, children: ['▶ Replay: 1 edit'] }],
    'band',
  )
  const line = span('▶ Replay: 1 edit')
  expect(line.className).not.toContain('font-mono')
  expect(line.className).toContain('font-medium')
  // Magenta is the accent tone, toned into the strip's text (`modColor.ts`), not a raw violet.
  expect(line.dataset.tone).toBe('accent')
  expect(span('▶').className).toContain('text-text-faint')
  await done()
})

test('a frame nested in a pane is a card of the app’s, not a coloured outline', async () => {
  const { host, done } = await render(
    [{ type: 'Box', props: { borderStyle: 'round', borderColor: 'magenta' }, children: ['card'] }],
    'pane',
  )
  const card = host.querySelector('div')!
  expect(card.className).toContain('border-border-faint')
  expect(card.className).toContain('rounded-md')
  expect(card.className).toContain('bg-foreground/[0.02]')
  expect(card.style.borderColor).toBe('')
  await done()
})
