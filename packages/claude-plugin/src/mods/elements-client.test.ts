import { describe, expect, test } from 'bun:test'
import { CLIENT_ELEMENT_NAMES, elementTable, h, serializeTree, type JsonElement } from './elements'
import { plainDataProblem } from './plain-data'

const known = { client: (module: string) => (module === 'hooks/spin.tsx' ? 'r1' : undefined) }

describe('Client', () => {
  test('the desktop table draws one, serialized with its own props and the module revision', () => {
    const { Box, Client } = elementTable()
    const { tree, clients, handlers } = serializeTree(
      h(
        Box,
        null,
        h(Client, { key: 'spin', module: 'hooks/spin.tsx', props: { n: 1 }, width: 10, extra: 1 }),
      ),
      known,
    )
    expect(tree[0]).toMatchObject({
      children: [
        {
          type: 'Client',
          props: { key: 'spin', module: 'hooks/spin.tsx', props: { n: 1 }, width: 10 },
          client: { revision: 'r1' },
        },
      ],
    })
    expect(((tree[0] as JsonElement).children[0] as JsonElement).props).not.toHaveProperty('extra')
    expect(clients).toEqual(new Map([['spin', 'hooks/spin.tsx']]))
    expect(handlers.size).toBe(0)
  })

  test('is refused without a key, on a shared key, with a module not read at load, or bad props', () => {
    const { Box, Client } = elementTable()
    const draw = (...children: unknown[]) =>
      serializeTree(h(Box, null, ...(children as never[])), known)
    expect(() => draw(Client({ module: 'hooks/spin.tsx' }))).toThrow('no key')
    expect(() =>
      draw(
        Client({ key: 'a', module: 'hooks/spin.tsx' }),
        Client({ key: 'a', module: 'hooks/spin.tsx' }),
      ),
    ).toThrow('share the key')
    expect(() => draw(Client({ key: 'a', module: './spin.tsx' }))).toThrow(
      'not read off the source',
    )
    expect(() => serializeTree(Client({ key: 'a', module: 'hooks/spin.tsx' }))).toThrow(
      'not read off the source',
    )
    expect(() =>
      draw(Client({ key: 'a', module: 'hooks/spin.tsx', props: { f: () => 1 } })),
    ).toThrow('plain data')
    expect(() => draw(Client({ key: 'a', module: 'hooks/spin.tsx', width: 'wide' }))).toThrow(
      'percentage',
    )
    expect(draw(Client({ key: 'a', module: 'hooks/spin.tsx', height: '50%' })).tree).toHaveLength(1)
  })

  test('a surface module draws with the terminal table less Client, Raster and Image', () => {
    expect([...CLIENT_ELEMENT_NAMES]).toEqual([
      'Box',
      'Text',
      'Button',
      'Input',
      'Select',
      'Link',
      'Code',
      'Markdown',
    ])
  })

  test('every tree keeps its bounds: elements and depth', () => {
    const { Box, Text } = elementTable()
    let deep = Text({ children: 'x' })
    for (let i = 0; i < 40; i++) deep = Box({ children: deep })
    expect(() => serializeTree(deep)).toThrow('nests too deep')
    const wide = Box({ children: Array.from({ length: 20_001 }, () => Text({})) })
    expect(() => serializeTree(wide)).toThrow('too many elements')
  })
})

test('plain data is what JSON holds, within a tree’s bounds', () => {
  expect(plainDataProblem({ a: [1, 'x', null, true, { b: 2 }] })).toBeNull()
  expect(plainDataProblem(undefined)).toContain('undefined')
  expect(plainDataProblem({ f: () => 1 })).toContain('function')
  expect(plainDataProblem(new Date())).toContain('not plain')
  expect(plainDataProblem(Number.NaN)).toContain('finite')
  expect(plainDataProblem('x'.repeat(100_001))).toContain('characters')
  const cycle: Record<string, unknown> = {}
  cycle.self = cycle
  expect(plainDataProblem(cycle)).toContain('deeper')
})
