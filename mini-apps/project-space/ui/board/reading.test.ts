import { describe, expect, test } from 'bun:test'
import { emptySpace } from '../../shared/format/document'
import { linksOf } from '../../shared/graph/links'
import { neighbourhood, reach } from '../../shared/graph/reach'
import { applyOps } from '../../shared/ops/apply'
import { spaceTypes } from '../../shared/types'
import { namesOf } from './Announcer'
import { depthAt } from './DetailDepth'
import { menuSections, type MenuContext } from './menuItems'
import { traceSummary } from './TraceChip'
import { readingMarks, type BoardReading } from './useReading'

const space = applyOps(
  emptySpace(),
  [
    { op: 'create', type: 'note', id: 'web', x: 0, y: 0, text: 'Web app' },
    { op: 'create', type: 'note', id: 'api', x: 300, y: 0, text: 'API server' },
    { op: 'create', type: 'note', id: 'db', x: 600, y: 0, text: 'Postgres' },
    { op: 'create', type: 'note', id: 'aside', x: 0, y: 400, text: 'Unrelated' },
    { op: 'connect', id: 'e1', from: 'web', to: 'api' },
    { op: 'connect', id: 'e2', from: 'api', to: 'db' },
  ],
  { registry: spaceTypes },
).space
const links = linksOf(space)

const traced = (origin: string): BoardReading => ({
  trace: { origin, direction: 'downstream' },
  lit: { kind: 'trace', ...reach(space, origin, 'downstream', links) },
  toggleTrace: () => undefined,
  clearTrace: () => true,
  links,
})

describe('the reading on the drawing', () => {
  test('a trace keeps what it found and lets the rest recede', () => {
    const marks = readingMarks(traced('api').lit)
    expect(['api', 'db'].map(marks.dims)).toEqual([false, false])
    expect(['web', 'aside'].map(marks.dims)).toEqual([true, true])
    expect(marks.edge('e2')).toBe('focus')
    expect(marks.edge('e1')).toBe('dimmed')
  })

  test('one selected element lights its connectors and dims nothing', () => {
    const marks = readingMarks({ kind: 'near', ...neighbourhood(space, 'api', links) })
    expect(['web', 'aside'].map(marks.dims)).toEqual([false, false])
    expect([marks.edge('e1'), marks.edge('e2')]).toEqual(['focus', 'focus'])
    expect(readingMarks(null).edge('e1')).toBeNull()
  })

  test('the chip says which way, from what, and how far', () => {
    expect(traceSummary(space, traced('web'))).toBe('Downstream of Web app · 2 elements · 2 hops')
  })

  test('the small print follows the zoom in three depths', () => {
    expect([0.3, 0.6, 1, 2].map(depthAt)).toEqual(['map', 'read', 'full', 'full'])
  })

  test('an announcement names a few elements and counts the rest', () => {
    expect(namesOf(space, ['web', 'api', 'db', 'aside', 'gone'])).toBe(
      'Web app, API server, Postgres and 1 more',
    )
  })
})

describe('the right-click menu', () => {
  const context = (reading = traced('api')): MenuContext => ({
    space,
    entered: null,
    sessionId: 's',
    reading,
    commit: () => undefined,
    edit: () => undefined,
    copyImage: () => undefined,
    saveImage: () => undefined,
    addNote: () => undefined,
    selectAll: () => undefined,
    fit: () => undefined,
    openFind: () => undefined,
    openShortcuts: () => undefined,
    style: { copied: () => null, copy: () => undefined },
    frame: () => undefined,
  })
  const labels = (sections: ReturnType<typeof menuSections>) =>
    sections.flat().map((item) => item.label)

  test('an element offers what applies to it, and only that', () => {
    const items = labels(menuSections({ kind: 'elements', ids: ['api'] }, context()))
    expect(items).toContain('Edit')
    expect(items).toContain('Trace upstream · 1')
    expect(items).toContain('Trace downstream · 1')
    expect(items).toContain('Copy as image')
    // One element is no group: grouping is left out, not greyed.
    expect(items).not.toContain('Group')
    expect(items).toContain('Frame the selection')
    expect(items).toContain('Copy style')
    // Nothing was copied yet, so there is nothing to paste.
    expect(items).not.toContain('Paste style')
    // Nothing flows into `web`, so it offers no upstream trace.
    const web = labels(menuSections({ kind: 'elements', ids: ['web'] }, context()))
    expect(web.some((label) => label.startsWith('Trace upstream'))).toBe(false)
  })

  test('the ground offers the board, a connector its own acts', () => {
    const ground = labels(menuSections({ kind: 'ground', at: { x: 0, y: 0 } }, context()))
    expect(ground).toEqual([
      'Add a note here',
      'Find…',
      'Select all',
      'Fit the board',
      'Copy the board as image',
      'Save the board as image…',
      'Keyboard shortcuts',
    ])
    expect(labels(menuSections({ kind: 'edge', id: 'e1' }, context()))).toEqual([
      'Reverse',
      'Insert a shape',
      'Delete connector',
    ])
  })

  test('its trace item is the same toggle the connections menu uses', () => {
    const asked: string[] = []
    const reading = {
      ...traced('api'),
      toggleTrace: (id: string, way: string) => asked.push(`${id}:${way}`),
    }
    const item = menuSections({ kind: 'elements', ids: ['api'] }, context(reading as BoardReading))
      .flat()
      .find((entry) => entry.label.startsWith('Trace downstream'))
    item?.run()
    expect(asked).toEqual(['api:downstream'])
  })
})
