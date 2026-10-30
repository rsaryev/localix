import { describe, expect, test } from 'bun:test'

import { readCollections } from './collections'

const own = (name: string) => ({ kind: 'mini-app' as const, id: `${name}@ada` })

describe("a marketplace keeper's rows for Discover", () => {
  test('an item is one of the marketplace’s own by name, or any package as <kind>:<id>', () => {
    expect(
      readCollections(
        [
          {
            id: 'data',
            title: 'Work with data',
            subtitle: 'Query and chart',
            style: 'grid',
            items: ['database', 'plugin:neon@claude-plugins-official', 'mini-app:notes@grace'],
          },
        ],
        own,
      ),
    ).toEqual([
      {
        id: 'data',
        title: 'Work with data',
        subtitle: 'Query and chart',
        style: 'grid',
        items: [
          { kind: 'mini-app', id: 'database@ada' },
          { kind: 'plugin', id: 'neon@claude-plugins-official' },
          { kind: 'mini-app', id: 'notes@grace' },
        ],
      },
    ])
  })

  test('a row is drawn as a row unless it asks for a grid', () => {
    expect(readCollections([{ id: 'a', title: 'A', style: 'carousel', items: [] }], own)).toEqual([
      { id: 'a', title: 'A', style: 'row', items: [] },
    ])
  })

  test('what does not read is dropped alone: a row without a title, an item of no kind', () => {
    expect(
      readCollections(
        [
          { id: 'untitled', items: ['database'] },
          { id: 'kept', title: 'Kept', items: ['database', 42, 'gadget:x', 'plugin:', ''] },
        ],
        own,
      ),
    ).toEqual([
      {
        id: 'kept',
        title: 'Kept',
        style: 'row',
        items: [{ kind: 'mini-app', id: 'database@ada' }],
      },
    ])
  })

  test('anything but a list is no rows', () => {
    expect(readCollections(undefined, own)).toEqual([])
    expect(readCollections({ id: 'a' }, own)).toEqual([])
  })
})
