import { describe, expect, test } from 'bun:test'
import { splitMentionSegments, type MentionSegment } from './mentionSegments'

const text = (value: string): MentionSegment => ({ type: 'text', value })
const mention = (value: string): MentionSegment => ({ type: 'mention', value })
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
