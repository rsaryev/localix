import { describe, expect, test } from 'bun:test'
import { contentFromText } from '../content/text'
import { emptySpace } from '../format/document'
import { applyOps } from '../ops/apply'
import { spaceTypes } from './index'
import { layoutSequence } from './sequence-layout'
import {
  readSequence,
  sequenceLineTokens,
  writeSequence,
  type SequenceContent,
} from './sequence-text'

describe('the layout of a sequence', () => {
  test('widens only the gaps a long label spans, so it never runs through the heads', () => {
    const content = (text: string): SequenceContent => ({
      title: '',
      participants: ['A', 'B', 'C'].map((id) => ({ id, kind: 'participant' as const })),
      messages: [{ from: 'A', to: 'B', text, kind: 'sync' }],
    })
    const short = layoutSequence(content('ok'))
    const long = layoutSequence(content('x'.repeat(80)))
    const gap = (layout: typeof short, a: string, b: string) =>
      (layout.columns.get(b) ?? 0) - (layout.columns.get(a) ?? 0)
    expect(gap(long, 'A', 'B')).toBeGreaterThanOrEqual(80 * 6.2)
    expect(gap(long, 'B', 'C')).toBe(gap(short, 'B', 'C'))
    expect(long.width).toBeGreaterThan(short.width)
  })
})

describe('the editor colours of a sequence line', () => {
  test('are the same reading as the parser: keywords, names, the arrow, the label', () => {
    const kinds = (line: string) =>
      sequenceLineTokens(line)
        .filter((token) => token.text.trim())
        .map((token) => `${token.kind}:${token.text.trim()}`)
    expect(kinds('  participant Web as Web UI')).toEqual([
      'keyword:participant',
      'name:Web',
      'keyword:as',
      'label:Web UI',
    ])
    expect(kinds('  API-->>Web: 201 Created')).toEqual([
      'name:API',
      'arrow:-->>',
      'name:Web',
      'plain::',
      'label:201 Created',
    ])
    expect(kinds('%% a note')).toEqual(['comment:%% a note'])
    // Every character is kept, so the coloured layer lines up with the text under the caret.
    const line = '  User->>App: submit'
    expect(
      sequenceLineTokens(line)
        .map((token) => token.text)
        .join(''),
    ).toBe(line)
  })
})

const MERMAID = [
  'sequenceDiagram',
  '  title Create a task',
  '  actor User',
  '  participant Web as Web UI',
  '  database DB',
  '  User->>Web: create',
  '  Web-)DB: INSERT',
  '  DB-->>Web: row',
].join('\n')

describe('a sequence diagram as text', () => {
  test('reads participants, their kinds and labels, and the three kinds of message', () => {
    const content = readSequence(MERMAID) as SequenceContent
    expect(content.title).toBe('Create a task')
    expect(content.participants).toEqual([
      { id: 'User', kind: 'actor' },
      { id: 'Web', kind: 'participant', label: 'Web UI' },
      { id: 'DB', kind: 'database' },
    ])
    expect(content.messages.map((message) => message.kind)).toEqual(['sync', 'async', 'return'])
  })

  test('writing it back gives the same text, and reading that the same content', () => {
    const content = readSequence(MERMAID) as SequenceContent
    expect(writeSequence(content)).toBe(MERMAID)
  })

  test('a participant named only in a message is created for it', () => {
    const content = readSequence('A->>B: hi') as SequenceContent
    expect(content.participants.map((participant) => participant.id)).toEqual(['A', 'B'])
  })

  test('text with nothing to draw is refused with how to write it', () => {
    expect(readSequence('hello there')).toContain('participant')
  })
})

describe('the sequence element', () => {
  test('the agent writes it as Mermaid and it is sized by its content', () => {
    const { space, results } = applyOps(
      emptySpace(),
      [{ op: 'create', type: 'sequence', id: 's', x: 0, y: 0, text: MERMAID }],
      { registry: spaceTypes },
    )
    expect(results[0]?.ok).toBe(true)
    const layout = layoutSequence(readSequence(MERMAID) as SequenceContent)
    expect(space.elements.s).toMatchObject({ w: layout.width, h: layout.height })
    // One more message, one more row: the element grows with it.
    const grown = applyOps(
      space,
      [{ op: 'update', id: 's', text: `${MERMAID}\n  Web-->>User: done` }],
      {
        registry: spaceTypes,
      },
    ).space
    expect(grown.elements.s!.h).toBeGreaterThan(space.elements.s!.h)
  })

  test('a message to a participant that is not there is refused', () => {
    const { results } = applyOps(
      emptySpace(),
      [
        {
          op: 'create',
          type: 'sequence',
          props: { participants: [{ id: 'A' }], messages: [{ from: 'A', to: 'Ghost' }] },
        },
      ],
      { registry: spaceTypes },
    )
    expect(results[0]).toMatchObject({ ok: false })
    expect((results[0] as { error: string }).error).toContain('"Ghost" is not a participant')
  })

  test('a pasted Mermaid sequence block becomes a native diagram', () => {
    expect(contentFromText(`\`\`\`mermaid\n${MERMAID}\n\`\`\``, spaceTypes)).toEqual({
      type: 'mermaid',
      props: { source: MERMAID },
    })
  })
})
