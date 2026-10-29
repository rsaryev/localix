import { describe, expect, test } from 'bun:test'
import type { MessageContextBinding } from '@/shared/api/contracts'
import { messageDisplayText } from './messageDisplayText'

const tokens = [
  '@snippet:Browser tabs',
  '@resource:localix://resource/git/PRJ-3/status',
  '@snippet:Sync — mini app context',
  '@terminal:e6a4d616',
  '@terminal:44ff402e',
  '@snippet:18cfa91a-2dbd-4c31-90b2-deaf98898e90',
]
const bindings: MessageContextBinding[] = tokens.map((token, index) => ({
  kind: 'context',
  id: String(index),
  source: 'mention',
  target: { kind: 'snippet', token, label: 'Context' },
  resolution: { status: 'pending', contributions: [] },
}))

describe('message display text', () => {
  test('projects the reported refs-only legacy message without rewriting it', () => {
    const text = tokens.join(' ')
    const before = JSON.stringify(bindings)
    expect(messageDisplayText(text, bindings)).toBe('')
    expect(text).toBe(tokens.join(' '))
    expect(JSON.stringify(bindings)).toBe(before)
  })
  test('keeps prose alongside exact bound refs', () => {
    expect(messageDisplayText(`Fix spacing\n${tokens.join(' ')}`, bindings)).toBe('Fix spacing')
    expect(messageDisplayText(`Please ${tokens[0]} inspect`, bindings)).toBe('Please  inspect')
  })
  test('does not guess about unknown refs, prefixes, quotes or code', () => {
    const text = '@snippet:unknown @terminal:e6a4d616-extra'
    expect(messageDisplayText(text, bindings)).toBe(text)
    for (const text of [
      '`@terminal:e6a4d616`',
      '```\n@terminal:e6a4d616\n```',
      '"@terminal:e6a4d616"',
    ]) {
      expect(messageDisplayText(text, bindings)).toBe(text)
    }
    expect(messageDisplayText(tokens.join(' '))).toBe(tokens.join(' '))
  })
  test('apostrophes are not quotations', () => {
    expect(messageDisplayText(`don't ${tokens[3]} isn't`, bindings)).toBe("don't  isn't")
    expect(messageDisplayText(`'${tokens[3]}'`, bindings)).toBe(`'${tokens[3]}'`)
  })
  test('image-only sends have no placeholder text', () => {
    expect(
      messageDisplayText('', [
        { kind: 'image', data: 'YWJj', mediaType: 'image/png', name: 'shot.png', size: 3 },
      ]),
    ).toBe('')
  })
})
