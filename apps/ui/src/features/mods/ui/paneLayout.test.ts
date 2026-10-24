import { describe, expect, test } from 'bun:test'
import type { ModElement } from '@/shared/api/modsApi'
import { paneLayout } from './paneLayout'

const text = (children: string, props: Record<string, unknown> = {}): ModElement => ({
  type: 'Text',
  props,
  children: [children],
})
const box = (props: Record<string, unknown>, children: ModElement[]): ModElement => ({
  type: 'Box',
  props,
  children,
})
const button = (key: string, props: Record<string, unknown> = {}): ModElement => ({
  type: 'Button',
  props: { key, label: key, ...props },
  children: [],
})

/** A made-up mod's pane, framed as a terminal box: a title row, a body, a row of buttons. */
const framed = (title: ModElement, last: ModElement) =>
  box({ flexDirection: 'column', borderStyle: 'round', borderColor: 'magenta', paddingX: 1 }, [
    box({ flexDirection: 'row', justifyContent: 'space-between' }, [
      title,
      text('step 1 of 3', { bold: true }),
    ]),
    text('the body'),
    last,
  ])

describe('the tab is the frame', () => {
  test('a root box’s frame and padding go; its layout stays', () => {
    const { nodes } = paneLayout([framed(text('Other'), text('end'))], 'Pane')
    const root = nodes[0] as ModElement
    expect(root.props).toEqual({ flexDirection: 'column' })
  })

  test('through plain wrappers too, and a nested frame keeps its frame', () => {
    const inner = box({ borderStyle: 'single' }, [text('card')])
    const tree = [box({}, [box({ flexDirection: 'column', borderStyle: 'bold' }, [inner])])]
    const root = paneLayout(tree, 'Pane').nodes[0] as ModElement
    const unframed = root.children[0] as ModElement
    expect(unframed.props.borderStyle).toBeUndefined()
    expect((unframed.children[0] as ModElement).props.borderStyle).toBe('single')
  })

  test('two root boxes are not one frame', () => {
    const tree = [box({ borderStyle: 'round' }, []), box({ borderStyle: 'round' }, [])]
    expect(paneLayout(tree, 'Pane').nodes).toEqual(tree)
  })
})

describe('the tab already says the title', () => {
  test('a bold first line that only repeats it goes, glyph and case aside', () => {
    const tree = [framed(text('▶ Replay theater', { bold: true }), text('end'))]
    const root = paneLayout(tree, 'Replay Theater').nodes[0] as ModElement
    const first = root.children[0] as ModElement
    expect(first.children).toEqual([text('step 1 of 3', { bold: true })])
  })

  test('a title with more after it keeps what it adds', () => {
    const tree = [framed(text('⚠ Blast Radius · rm -rf', { bold: true }), text('end'))]
    const root = paneLayout(tree, 'Blast Radius').nodes[0] as ModElement
    const first = (root.children[0] as ModElement).children[0] as ModElement
    expect(first.children).toEqual(['rm -rf'])
  })

  test('a line that is not bold, or says something else, stays', () => {
    const plain = [framed(text('Replay Theater'), text('end'))]
    const root = paneLayout(plain, 'Replay Theater').nodes[0] as ModElement
    expect((root.children[0] as ModElement).children).toHaveLength(2)
  })
})

describe('a last row of buttons is the pane’s action bar', () => {
  test('buttons, and a hint beside them, leave the body for the bar', () => {
    const bar = box({ marginTop: 1, gap: 2 }, [
      button('Proceed', { plain: true }),
      button('Cancel'),
      text('waiting', { dimColor: true }),
    ])
    const { nodes, actions } = paneLayout([framed(text('x'), bar)], 'Pane')
    expect(actions?.map((node) => (node as ModElement).type)).toEqual(['Button', 'Button', 'Text'])
    expect((nodes[0] as ModElement).children).toHaveLength(2)
  })

  test('a last row of text, or a row with a nested box, is body', () => {
    expect(paneLayout([framed(text('x'), text('end'))], 'Pane').actions).toBeNull()
    const mixed = box({}, [button('a'), box({}, [button('b')])])
    expect(paneLayout([framed(text('x'), mixed)], 'Pane').actions).toBeNull()
    const words = box({}, [text('a'), text('b')])
    expect(paneLayout([framed(text('x'), words)], 'Pane').actions).toBeNull()
  })
})
