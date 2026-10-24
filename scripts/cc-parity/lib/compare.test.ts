import { expect, test } from 'bun:test'

import { diffSnapshots, diffSurfaces, parity, shapeDelta } from './compare.mjs'

const usage = { input_tokens: 'number', output_tokens: 'number' }
const claude = {
  entries: [
    { kind: 'call', name: 'model.fork', shape: { isAnswered: 'boolean', text: 'string', usage } },
    { kind: 'call', name: 'model.complete', shape: { isAnswered: 'boolean', text: 'string' } },
    { kind: 'event', name: 'turn.complete', shape: { answer: 'string', 'usage?': usage } },
    { kind: 'event', name: 'ui.render:Spinner', shape: { word: 'string' } },
  ],
}
const localix = {
  entries: [
    { kind: 'call', name: 'model.fork', shape: { isAnswered: 'boolean', text: 'string', usage } },
    { kind: 'call', name: 'model.complete', shape: 'string' },
    { kind: 'event', name: 'turn.complete', shape: { answer: 'string', turnId: 'string' } },
    { kind: 'event', name: 'turn.local', shape: {} },
  ],
}

test('a shape delta names each field one side lacks or types otherwise', () => {
  expect(shapeDelta({ a: 'string', b: { c: 'number' } }, { a: 'number', b: {} })).toEqual([
    'a: string ≠ number',
    'b.c: number ≠ (missing)',
  ])
  // A key one side only sometimes has is a variant neither side must have: not a difference.
  expect(shapeDelta({ a: 'string', 'b?': 'string' }, { a: 'string' })).toEqual([])
})

test('a kind the other side also shows, and a key set to undefined, are no difference', () => {
  // Claude Code's `surface` is null in a `-p` run and a string in a terminal; Localix's a string.
  expect(shapeDelta({ surface: { $oneOf: ['null', 'string'] } }, { surface: 'string' })).toEqual([])
  expect(shapeDelta({ a: 'number' }, { a: { $oneOf: ['null', 'string'] } })).toEqual([
    'a: number ≠ null|string',
  ])
  // A mod reads `e.context` as undefined whether the key is there or not.
  expect(shapeDelta({ text: 'string' }, { text: 'string', context: 'undefined' })).toEqual([])
})

test('the parity report sorts every entry into same, different, missing or unobserved', () => {
  const report = parity(claude, localix, { known: { 'call:model.complete': 'returns text' } })
  expect(report.map(({ key, status }) => [key, status])).toEqual([
    ['call:model.complete', 'different shape'],
    ['call:model.fork', 'same'],
    ['event:turn.complete', 'different shape'],
    ['event:turn.local', 'not observed in Claude Code'],
    ['event:ui.render:Spinner', 'missing in Localix'],
  ])
  expect(report[0]).toMatchObject({ gap: 'returns text', delta: ['(top): object ≠ string'] })
  expect(report[2]!.delta).toEqual(['turnId: (missing) ≠ string'])
})

test('a diff between two versions lists what was added, removed or changed shape', () => {
  const older = { entries: claude.entries.slice(0, 3) }
  const newer = {
    entries: [
      { ...claude.entries[0]!, shape: { isAnswered: 'boolean', reason: 'string' } },
      ...claude.entries.slice(2),
    ],
  }
  expect(diffSnapshots(older, newer)).toEqual({
    added: ['event:ui.render:Spinner'],
    removed: ['call:model.complete'],
    changed: [
      {
        key: 'call:model.fork',
        delta: [
          'reason: (missing) ≠ string',
          'text: string ≠ (missing)',
          'usage: object ≠ (missing)',
        ],
      },
    ],
  })
})

test('a surface diff lists the names that came and went', () => {
  const older = { events: { 'tool.call': ['tool'] }, api: { ui: ['log'] }, renderSites: {} }
  const newer = {
    events: { 'tool.call': ['tool', 'agentId'], 'turn.start': [] },
    api: { ui: [] },
    renderSites: { Spinner: ['word'] },
  }
  expect(diffSurfaces(older, newer)).toEqual([
    '+ event turn.start',
    '+ event tool.call field agentId',
    '- api ui.log',
    '+ render site Spinner',
  ])
})
