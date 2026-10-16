import { describe, expect, test } from 'bun:test'
import { splitMentionSegments, type MentionSegment } from './mentionSegments'

const text = (value: string): MentionSegment => ({ type: 'text', value })
const mention = (value: string): MentionSegment => ({ type: 'mention', value })
const agent = (value: string, handle: string): MentionSegment => ({ type: 'agent', value, handle })
const NL = text('\n') // the always-appended trailing newline

describe('splitMentionSegments', () => {
  test('plain text becomes one run plus the trailing newline', () => {
    expect(splitMentionSegments('hello world')).toEqual([text('hello world'), NL])
  })

  test('empty string is just the trailing newline', () => {
    expect(splitMentionSegments('')).toEqual([NL])
  })

  test('a link-only @path is pilled, surrounded by its plain text', () => {
    expect(splitMentionSegments('see @src/a.ts here')).toEqual([
      text('see '),
      mention('@src/a.ts'),
      text(' here'),
      NL,
    ])
  })

  test('context-refs @file:/@folder:/@session: each classify as mentions', () => {
    expect(splitMentionSegments('@file:foo.ts')).toEqual([mention('@file:foo.ts'), NL])
    expect(splitMentionSegments('@folder:src')).toEqual([mention('@folder:src'), NL])
    expect(splitMentionSegments('@session:LOCALIX-42')).toEqual([
      mention('@session:LOCALIX-42'),
      NL,
    ])
  })

  test('a non-path @token (no slash/extension) stays plain text', () => {
    expect(splitMentionSegments('hi @someone there')).toEqual([text('hi @someone there'), NL])
  })

  test('trailing punctuation is left outside the pilled token', () => {
    expect(splitMentionSegments('see @a.ts.')).toEqual([
      text('see '),
      mention('@a.ts'),
      text('.'),
      NL,
    ])
  })

  test('a mention at the very start (no leading whitespace) is matched', () => {
    expect(splitMentionSegments('@a.ts done')).toEqual([mention('@a.ts'), text(' done'), NL])
  })

  test('multiple mentions split the text between them', () => {
    expect(splitMentionSegments('@a.ts and @b/c.ts')).toEqual([
      mention('@a.ts'),
      text(' and '),
      mention('@b/c.ts'),
      NL,
    ])
  })
})

describe('splitMentionSegments — the party’s own handles', () => {
  const PARTY = ['localix', 'qa', 'backend', 'back', 'all']

  test('a handle in the party is its own segment, carrying who it names', () => {
    // It needs the handle, not just the text: the pill is drawn in that member's colour.
    expect(splitMentionSegments('@qa please check', PARTY)).toEqual([
      agent('@qa', 'qa'),
      text(' please check'),
      NL,
    ])
  })

  test('a handle outside the party stays plain text', () => {
    expect(splitMentionSegments('@nobody hello', PARTY)).toEqual([text('@nobody hello'), NL])
  })

  test('punctuation after a handle ends it and stays in the sentence', () => {
    // People write a name mid-sentence; a pill that swallowed the comma would be visibly wrong.
    expect(splitMentionSegments('ok @qa, and you?', PARTY)).toEqual([
      text('ok '),
      agent('@qa', 'qa'),
      text(', and you?'),
      NL,
    ])
  })

  test('the LONGEST handle wins, so a room holding both names pills the whole one', () => {
    expect(splitMentionSegments('@backend ships it', PARTY)).toEqual([
      agent('@backend', 'backend'),
      text(' ships it'),
      NL,
    ])
  })

  test('a party handle beats the file reading of the same token', () => {
    // `@backend` is a colleague here and a plausible path anywhere. In a room the colleague is
    // what the person means, and a file chip would say the opposite of what the message does.
    const [first] = splitMentionSegments('@backend/api.ts', PARTY)
    expect(first).toEqual(agent('@backend', 'backend'))
  })

  test('with no party, nothing changes', () => {
    expect(splitMentionSegments('@qa please check')).toEqual([text('@qa please check'), NL])
  })

  test('a chip is drawn exactly where the conversation routes', () => {
    // The composer had its own grammar — whitespace-only boundary, case-sensitive — so "@QA" and
    // "(@qa" routed to @qa with no chip in the draft.
    expect(splitMentionSegments('@QA look', PARTY)[0]).toEqual(agent('@QA', 'qa'))
    expect(splitMentionSegments('(@qa)', PARTY)).toEqual([
      text('('),
      agent('@qa', 'qa'),
      text(')'),
      NL,
    ])
  })
})
