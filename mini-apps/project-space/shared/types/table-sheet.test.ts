import { expect, test } from 'bun:test'
import { emptySpace } from '../format/document'
import { contentFromText } from '../content/text'
import { applyOps } from '../ops/apply'
import { spaceTypes } from './index'
import { tableToNotesOps } from './table-ops'

test('cells pasted from a spreadsheet become a table, and a table becomes notes by column', () => {
  const sheet = 'Idea\tOwner\nOffline mode\tAna\nDark theme\t\n'
  const content = contentFromText(sheet, spaceTypes)
  expect(content).toEqual({
    type: 'table',
    props: {
      columns: ['Idea', 'Owner'],
      rows: [
        ['Offline mode', 'Ana'],
        ['Dark theme', ''],
      ],
    },
  })
  // A ragged paste is prose, not a sheet.
  expect(contentFromText('a\tb\nc', spaceTypes).type).not.toBe('table')

  let next = 0
  const ops = tableToNotesOps({ x: 0, y: 0, w: 400 }, content.props as never, () => `n${next++}`)
  const after = applyOps(emptySpace(), ops, { registry: spaceTypes }).space
  const notes = Object.values(after.elements)
  expect(notes.map((note) => note.props.text)).toEqual([
    '**Idea**',
    'Offline mode',
    'Dark theme',
    '**Owner**',
    'Ana',
  ])
  // One column of notes per table column, each in its own colour, all grouped.
  expect(new Set(notes.slice(0, 3).map((note) => note.x)).size).toBe(1)
  expect(notes[0]!.props.color).not.toBe(notes[3]!.props.color)
  expect(new Set(notes.map((note) => note.groups?.[0])).size).toBe(1)
})
