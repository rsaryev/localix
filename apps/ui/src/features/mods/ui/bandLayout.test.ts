import { expect, test } from 'bun:test'
import type { ModElement } from '@/shared/api/modsApi'
import { bandLayout } from './bandLayout'

const text = (value: string, props: Record<string, unknown> = {}): ModElement => ({
  type: 'Text',
  props,
  children: [value],
})
const button = (key: string, props: Record<string, unknown> = {}): ModElement => ({
  type: 'Button',
  props: { key, label: key, ...props },
  children: [],
})
const box = (props: Record<string, unknown>, ...children: ModElement[]): ModElement => ({
  type: 'Box',
  props,
  children,
})

test('a status line, a line with a button and a labelled list of picks', () => {
  // Two made-up mods composed into one band: a gauge, then a stack of a prompt and a list.
  const tree = [
    box(
      { flexDirection: 'column' },
      box({ flexDirection: 'row', gap: 2 }, text('Ready', { color: 'cyan' }), button('Run')),
      box({ marginTop: 1 }),
      text('pick:', { dimColor: true }),
      box({ marginLeft: 2 }, button('alpha', { plain: true, hotkey: '1' })),
      box({ marginLeft: 2 }, button('beta', { plain: true, hotkey: '2' })),
      box({ marginLeft: 2 }, button('skip', { plain: true, hotkey: '0' })),
    ),
    box({}, text('42% full')),
  ]
  const blocks = bandLayout(tree)
  expect(blocks.map((block) => block.kind)).toEqual(['line', 'choices', 'line'])
  const choices = blocks[1] as Extract<(typeof blocks)[number], { kind: 'choices' }>
  expect(choices.label?.map((node) => (node as ModElement).children)).toEqual([['pick:']])
  expect(choices.buttons.map((node) => node.props.key)).toEqual(['alpha', 'beta', 'skip'])
  expect(blocks.map((block) => block.summary)).toEqual([
    'Ready Run',
    'pick: alpha beta skip',
    '42% full',
  ])
})

test('one plain button is a line, and a label with a control is not taken for a list label', () => {
  const blocks = bandLayout([
    box({}, text('Waiting'), button('Stop')),
    button('only', { plain: true }),
  ])
  expect(blocks.map((block) => block.kind)).toEqual(['line', 'line'])
})

test('a framed box, a field or a multi-line column is drawn as it is', () => {
  const blocks = bandLayout([
    box({ borderStyle: 'round' }, text('framed')),
    { type: 'Input', props: { key: 'note' }, children: [] },
    box({ flexDirection: 'column', backgroundColor: 'blue' }, text('a'), text('b')),
  ])
  expect(blocks.map((block) => block.kind)).toEqual(['tree', 'tree', 'tree'])
})
