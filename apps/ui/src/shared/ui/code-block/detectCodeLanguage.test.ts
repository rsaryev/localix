import { describe, expect, test } from 'bun:test'
import { detectCodeLanguage } from './detectCodeLanguage'
import { highlightCodeTokens } from './highlightCode'

describe('automatic tool syntax detection', () => {
  test('recognizes JSON objects, arrays and newline-delimited records', () => {
    for (const text of ['{"action":"library","ok":true}', '[1,null,false]', '{"a":1}\n{"b":2}']) {
      expect(detectCodeLanguage(text)).toBe('json')
    }
  })

  test('recognizes supported fences and distinctive source constructs', () => {
    const cases = [
      ['```sql\nSELECT 1\n```', 'sql'],
      ['SELECT id FROM books WHERE active = true', 'sql'],
      ['def greet(name):\n    return name', 'python'],
      ['const value = 42', 'javascript'],
      ['interface Book { title: string }', 'typescript'],
      ['fn main() { println!("hi"); }', 'rust'],
      ['func main() { return }', 'go'],
      ['public class Main { }', 'java'],
      ['#include <stdio.h>\nint main() { return 0; }', 'cpp'],
      ['.book { color: red; }', 'css'],
    ]
    for (const [source, language] of cases) expect(detectCodeLanguage(source!)).toBe(language)
  })

  test('leaves ambiguous prose, logs, malformed JSON, unsupported fences and large output plain', () => {
    for (const source of [
      '',
      'Done',
      'true',
      '42',
      'The return value is null.',
      'ERROR src/app.ts:42: unexpected token',
      '{"incomplete":',
      '```yaml\nkey: value\n```',
      '{"text":"' + 'x'.repeat(32_000) + '"}',
    ])
      expect(detectCodeLanguage(source)).toBeUndefined()
  })

  test('tokens preserve all text including whitespace, URLs and markup', () => {
    const source =
      ' {"path":"/workspace/a.ts", "url":"https://example.com/a.ts", "html":"<script>&"}\n'
    const tokens = highlightCodeTokens(source, 'json')!
    expect(tokens.map((token) => token.text).join('')).toBe(source)
    expect(tokens.at(-1)?.end).toBe(source.length)
    expect(highlightCodeTokens(source, 'unknown')).toBeNull()
  })
})
