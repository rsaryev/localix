import { describe, expect, test } from 'bun:test'
import { editorLanguage, formatJsonBody, offsetAt, variableCompletions } from './bodyEditor'

describe('formatJsonBody', () => {
  test('pretty-prints valid JSON', () => {
    expect(formatJsonBody('{"a":1,"b":[2]}')).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}')
  })
  test('returns invalid JSON unchanged — never eats an in-progress body', () => {
    expect(formatJsonBody('{"a":')).toBe('{"a":')
  })
})

describe('editorLanguage', () => {
  test('maps the mime families; unknown is plain text', () => {
    expect(editorLanguage('application/json')).toBe('json')
    expect(editorLanguage('application/vnd.api+json')).toBe('json')
    expect(editorLanguage('text/html')).toBe('html')
    expect(editorLanguage('application/xml')).toBe('xml')
    expect(editorLanguage('text/plain')).toBe('text')
    expect(editorLanguage(undefined)).toBe('text')
  })
})

describe('variableCompletions', () => {
  const vars = [
    { name: 'base_url', value: 'https://api.dev' },
    { name: 'token', value: 't', disabled: true },
  ]

  test('offered only right after {{, closing the braces', () => {
    const text = '{"url": "{{ba'
    const items = variableCompletions(text, text.length, vars)
    expect(items.map((i) => i.label)).toEqual(['base_url'])
    expect(items[0].insertText).toBe('base_url}}')
  })

  test('not offered mid-word without braces', () => {
    const text = '{"name": "ba'
    expect(variableCompletions(text, text.length, vars)).toEqual([])
  })

  test('does not double-close when }} already follows', () => {
    const text = '{{ba}}'
    const items = variableCompletions(text, 4, vars)
    expect(items[0].insertText).toBe('base_url')
  })

  test('disabled variables are not offered (prefix filtering is the editor’s job)', () => {
    const text = '{{t'
    const items = variableCompletions(text, text.length, vars)
    // `token` is disabled, so absent; `base_url` is present — the editor filters by prefix.
    expect(items.map((i) => i.label)).toEqual(['base_url'])
  })
})

describe('offsetAt', () => {
  test('walks lines', () => {
    const text = 'ab\ncd\nef'
    expect(offsetAt(text, 0, 1)).toBe(1)
    expect(offsetAt(text, 1, 0)).toBe(3)
    expect(offsetAt(text, 2, 2)).toBe(8)
    expect(offsetAt(text, 9, 0)).toBe(8)
  })
})
