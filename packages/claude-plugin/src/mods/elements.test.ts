import { describe, expect, test } from 'bun:test'
import { elementTable, Fragment, h, InvalidTreeError, serializeTree } from './elements'

describe('mod elements', () => {
  test('a tree built with the table or JSX serializes to JSON, its closures kept by key', () => {
    const { Box, Text, Button } = elementTable()
    let pressed = 0
    const tree = h(
      Box,
      { gap: 1 },
      h(Text, { bold: true }, 'Count: ', 3),
      h(
        Fragment,
        null,
        false,
        null,
        h(Button, { key: 'more', label: 'More', onPress: () => pressed++ }),
      ),
    )
    const { tree: json, handlers } = serializeTree(tree)
    expect(json).toEqual([
      {
        type: 'Box',
        props: { gap: 1 },
        children: [
          { type: 'Text', props: { bold: true }, children: ['Count: ', '3'] },
          { type: 'Button', props: { key: 'more', label: 'More' }, children: [] },
        ],
      },
    ])
    handlers.get('more')?.onPress?.()
    expect(pressed).toBe(1)
    expect(Object.isFrozen(Box({ gap: 1 }))).toBe(true)
  })

  test('a control without a key, or two on one key, is refused', () => {
    const { Box, Button } = elementTable()
    expect(() => serializeTree(Button({ label: 'x' }))).toThrow(InvalidTreeError)
    expect(() =>
      serializeTree(
        Box({ children: [Button({ key: 'a', label: '1' }), Button({ key: 'a', label: '2' })] }),
      ),
    ).toThrow('share the key')
  })
})

test('an Svg carries its markup and alt text, and is refused without them', () => {
  const { Svg, Box } = elementTable()
  const drawn = serializeTree(
    Box({ children: [Svg({ source: '<svg viewBox="0 0 1 1"></svg>', alt: 'A dot', width: 8 })] }),
  )
  expect(drawn.tree[0]).toMatchObject({
    children: [{ type: 'Svg', props: { alt: 'A dot', width: 8 } }],
  })
  expect(() => serializeTree(Svg({ source: '<script/>', alt: 'x' }))).toThrow('<svg> markup')
  expect(() => serializeTree(Svg({ source: '<svg/>' }))).toThrow('alt text')
})
