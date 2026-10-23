import { describe, expect, test } from 'bun:test'
import { contentFromText } from '../content/text'
import { emptySpace } from '../format/document'
import { applyOps } from '../ops/apply'
import { spaceTypes } from '../types'
import { describeSpace } from './describe'

test('explicit ids expose full native content and reference props while broad reads remain compact', () => {
  const code = `${'const value = 1\n'.repeat(20)}// final line`
  const { space } = applyOps(
    emptySpace(),
    [
      { op: 'create', id: 'code', type: 'code', props: { code, language: 'ts' } },
      {
        op: 'create',
        id: 'table',
        type: 'table',
        props: { columns: ['A'], rows: [['exact cell']] },
      },
      {
        op: 'create',
        id: 'image',
        type: 'image',
        props: { url: 'https://example.com/image.png', alt: 'Example' },
      },
    ],
    { registry: spaceTypes },
  )
  const broad = describeSpace(space, spaceTypes)
  expect(broad).not.toContain('final line')
  const targeted = describeSpace(space, spaceTypes, { ids: ['code', 'table', 'image'] })
  expect(targeted).toContain(JSON.stringify(code))
  expect(targeted).toContain('"rows":[["exact cell"]]')
  expect(targeted).toContain('"url":"https://example.com/image.png"')
})

const board = applyOps(
  emptySpace(),
  [
    { op: 'create', type: 'frame', id: 'auth', x: 0, y: 0, w: 700, h: 500, text: 'Auth' },
    { op: 'create', type: 'note', id: 'idea', in: 'auth', text: 'Tokens expire   too early' },
    { op: 'create', type: 'file', id: 'login', in: 'auth', props: { path: 'src/login.ts' } },
    { op: 'create', type: 'note', id: 'misc', x: 1200, y: 0, text: 'Unrelated' },
    { op: 'connect', id: 'e1', from: 'idea', to: 'login', label: 'see' },
  ],
  { registry: spaceTypes },
).space

describe('the agent roster', () => {
  test('broad reads name imported source, and targeted reads return it without truncation', () => {
    const source = `sequenceDiagram\nA->>B: ${'message '.repeat(50)}\nB-->>A: Done`
    const space = applyOps(
      emptySpace(),
      [
        {
          op: 'create',
          type: 'image',
          id: 'diagram',
          props: { path: 'diagram.svg', source, sourceFormat: 'mermaid', alt: 'Sequence' },
        },
      ],
      { registry: spaceTypes },
    ).space
    const broad = describeSpace(space, spaceTypes)
    expect(broad).toContain('mermaid source available')
    expect(broad).not.toContain(source)
    expect(describeSpace(space, spaceTypes, { ids: ['diagram'] })).toContain(source)
    expect(describeSpace(space, spaceTypes, { ids: ['other'] })).not.toContain(source)
  })
  test('one line per element with its frame and text, one arrow per connector', () => {
    const text = describeSpace(board, spaceTypes, { missing: new Set(['login']) })
    expect(text).toContain('[idea] note (')
    expect(text).toContain('in auth: Tokens expire too early')
    expect(text).toContain('[login] file (')
    expect(text).toContain('src/login.ts — MISSING on disk')
    expect(text).toContain('[e1] idea → login "see"')
  })

  test('groups (innermost first), a lock and a fade are named on the line', () => {
    const grouped = applyOps(
      board,
      [
        { op: 'group', ids: ['idea', 'login'], id: 'pair' },
        { op: 'update', id: 'misc', opacity: 0.3, locked: true },
      ],
      { registry: spaceTypes },
    ).space
    const text = describeSpace(grouped, spaceTypes)
    expect(text).toContain('in auth group pair: Tokens expire')
    expect(text).toContain('[misc] note (1200,0 200×200) locked opacity 0.3: Unrelated')
  })

  test('a frame filter narrows the roster to what the frame holds', () => {
    const text = describeSpace(board, spaceTypes, { frame: 'auth' })
    expect(text).toContain('[idea]')
    expect(text).not.toContain('[misc]')
  })

  test('a board over the limit is summarized by frame instead of listed', () => {
    const text = describeSpace(board, spaceTypes, { limit: 2 })
    expect(text).toContain('[auth] frame "Auth" — 2 elements')
    expect(text).not.toContain('[misc]')
  })
})

describe('pasted text', () => {
  test('is sorted by its structure: a link, a fenced block, a short note, a long text', () => {
    expect(contentFromText(' https://example.com/a ', spaceTypes)).toEqual({
      type: 'link',
      props: { url: 'https://example.com/a' },
    })
    expect(contentFromText('```ts\nconst a = 1\n```', spaceTypes)).toEqual({
      type: 'code',
      props: { code: 'const a = 1', language: 'ts' },
    })
    expect(contentFromText('Remember the login bug', spaceTypes).type).toBe('note')
    expect(contentFromText('x\n'.repeat(12), spaceTypes).type).toBe('text')
  })
})
