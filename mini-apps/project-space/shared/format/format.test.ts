import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { createTypeRegistry } from '../registry/registry'
import { spaceTypes } from '../types'
import { parseSpace } from './parse'
import { serializeSpace } from './serialize'

const file = (body: Record<string, unknown>) =>
  JSON.stringify({ format: 'localix.project-space', version: 1, ...body })

describe('reading a board file', () => {
  test('a written board reads back to the same bytes', () => {
    const text = file({
      elements: {
        k3f9: { type: 'note', x: 10, y: 20, w: 200, h: 160, props: { text: 'Hi' } },
        b2c4: { type: 'file', x: 300, y: 20, w: 320, h: 200, props: { path: 'src/a.ts' } },
      },
      edges: { e7m2: { from: 'k3f9', to: 'b2c4', label: 'reads' } },
    })
    const first = serializeSpace(parseSpace(text, spaceTypes).space)
    expect(serializeSpace(parseSpace(first, spaceTypes).space)).toBe(first)
  })

  test('props get their defaults, geometry is rounded, missing stacking keys are assigned', () => {
    const { space, issues } = parseSpace(
      file({ elements: { k3f9: { type: 'note', x: 10.4, y: 0, w: 200, h: 160 } } }),
      spaceTypes,
    )
    expect(issues).toEqual([])
    expect(space.elements.k3f9?.props).toEqual({
      text: '',
      color: 'yellow',
      size: 'md',
      font: 'sans',
      align: 'start',
      valign: 'top',
    })
    expect(space.elements.k3f9?.z).not.toBe('')
    expect(serializeSpace(space)).toContain('"x": 10,')
  })

  test('an unknown type, unknown keys and an undrawable record survive a write', () => {
    const text = file({
      mood: 'kept',
      elements: {
        k3f9: { type: 'hologram', x: 0, y: 0, w: 10, h: 10, z: 'a0', glow: 3, props: { beam: 1 } },
        b2c4: { type: 'note', x: 0, y: 0 },
      },
    })
    const { space, issues } = parseSpace(text, spaceTypes)
    expect(issues.map((issue) => issue.path)).toEqual(['elements.k3f9.props', 'elements.b2c4'])
    const written = JSON.parse(serializeSpace(space))
    expect(written.mood).toBe('kept')
    expect(written.elements.k3f9).toMatchObject({ type: 'hologram', glow: 3, props: { beam: 1 } })
    expect(written.elements.b2c4).toEqual({ type: 'note', x: 0, y: 0 })
  })

  test('a file that is not a board is reported and refuses to be written over', () => {
    for (const text of ['{ not json', JSON.stringify({ nodes: [] }), file({ version: 9 })]) {
      const parsed = parseSpace(text, spaceTypes)
      expect(parsed.writable).toBe(false)
      expect(parsed.issues).toHaveLength(1)
    }
    expect(parseSpace('', spaceTypes).writable).toBe(true)
  })

  test('a connector to a missing element is kept and reported, not drawn silently', () => {
    const { space, issues } = parseSpace(
      file({ edges: { e7m2: { from: 'gone', to: 'gone2' } } }),
      spaceTypes,
    )
    expect(space.edges.e7m2).toBeDefined()
    expect(issues.map((issue) => issue.path)).toEqual(['edges.e7m2.from', 'edges.e7m2.to'])
  })
})

describe('type versions', () => {
  const v2 = createTypeRegistry([
    {
      type: 'card',
      version: 2,
      label: 'Card',
      description: 'test',
      props: z.object({ title: z.string() }),
      // v1 called it `name`.
      migrations: [(props) => ({ title: props.name })],
      size: { w: 10, h: 10 },
      text: (props) => String(props.title),
    },
  ])
  const card = (types: Record<string, number>, props: Record<string, unknown>) =>
    file({ types, elements: { k3f9: { type: 'card', x: 0, y: 0, w: 1, h: 1, props } } })

  test('props written at an older version are migrated, and the file says the new version', () => {
    const { space } = parseSpace(card({ card: 1 }, { name: 'Old' }), v2)
    expect(space.elements.k3f9?.props).toEqual({ title: 'Old' })
    expect(JSON.parse(serializeSpace(space)).types).toEqual({ card: 2 })
  })

  test('props from a newer build are kept untouched under their own version', () => {
    const { space, issues } = parseSpace(card({ card: 5 }, { future: true }), v2)
    expect(issues[0]?.message).toContain('newer')
    const written = JSON.parse(serializeSpace(space))
    expect(written.types).toEqual({ card: 5 })
    expect(written.elements.k3f9.props).toEqual({ future: true })
  })

  test('a registry refuses a type without the migrations its version needs', () => {
    expect(() =>
      createTypeRegistry([
        {
          type: 'x',
          version: 2,
          label: 'X',
          description: 'x',
          props: z.object({}),
          size: { w: 1, h: 1 },
          text: () => '',
        },
      ]),
    ).toThrow('needs 1 migrations')
  })
})
