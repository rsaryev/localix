import { describe, expect, test } from 'bun:test'
import { previewBranchPayload } from './branching'
import type { StoredMessagePayload } from '../../../db'

const payload = (p: Record<string, unknown>): StoredMessagePayload =>
  p as unknown as StoredMessagePayload
const textItem = (text: string) => ({ id: text, status: 'complete', type: 'text', text })
const toolItem = () => ({
  id: 't',
  status: 'complete',
  type: 'tool_call',
  name: 'Bash',
  toolCallId: 't',
  activeVerb: 'x',
})

describe('previewBranchPayload', () => {
  test('uses content when present', () => {
    expect(previewBranchPayload(payload({ content: 'hello world' }))).toBe('hello world')
  })

  test('falls back to joined text items (tool items excluded)', () => {
    expect(
      previewBranchPayload(
        payload({ content: '', items: [textItem('a'), toolItem(), textItem('b')] }),
      ),
    ).toBe('a b')
  })

  test('collapses whitespace to single spaces and trims', () => {
    expect(previewBranchPayload(payload({ content: '  a\n\n  b\tc  ' }))).toBe('a b c')
  })

  test('truncates to 120 chars with an ellipsis', () => {
    const out = previewBranchPayload(payload({ content: 'x'.repeat(200) }))
    expect(out).toHaveLength(121) // 120 chars + the ellipsis glyph
    expect(out.endsWith('…')).toBe(true)
    expect(out.startsWith('x'.repeat(120))).toBe(true)
  })

  test('empty content and no text items → empty string', () => {
    expect(previewBranchPayload(payload({ content: '', items: [toolItem()] }))).toBe('')
    expect(previewBranchPayload(payload({}))).toBe('')
  })
})
