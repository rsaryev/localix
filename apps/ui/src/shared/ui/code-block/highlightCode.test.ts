import { describe, expect, test } from 'bun:test'

import { highlightCode } from './highlightCode'

describe('highlightCode', () => {
  test('highlights JSON strings, literals and numbers while escaping HTML', () => {
    const source = '{"message":"<script>&", "active":true, "count":42, "empty":null}'
    for (const language of ['json', ' JSON ', 'jsonc']) {
      const html = highlightCode(source, language)
      expect(html).toContain('sh__token--string')
      expect(html).toMatch(/sh__token--keyword[^>]*>true</)
      expect(html).toMatch(/sh__token--keyword[^>]*>null</)
      expect(html).toContain('42')
      expect(html).not.toContain('<script>')
    }
  })

  test('highlights SQL keywords, ClickHouse types, strings and comments without losing source', () => {
    const source =
      "CREATE TABLE sales (sale_date Date, product LowCardinality(String), quantity UInt32)\nENGINE = MergeTree ORDER BY (sale_date, product);\n-- note\nSELECT '<script>' FROM sales"
    for (const language of ['sql', 'clickhouse', 'postgresql', ' SQL ']) {
      const html = highlightCode(source, language)
      expect(html).toMatch(/sh__token--keyword[^>]*>CREATE</)
      expect(html).toMatch(/sh__token--class[^>]*>UInt32</)
      expect(html).toContain('sh__token--comment')
      expect(html).toContain('sh__token--string')
      expect(html).not.toContain('<script>')
    }
  })

  test('uses the C preset for C and C++ language ids', () => {
    for (const language of ['c', 'cpp']) {
      const html = highlightCode('int main(void) { return 0; }', language)
      expect(html).toContain('sh__token--class')
      expect(html).toContain('sh__token--keyword')
      expect(html).toContain('return')
    }
  })

  test('uses the Java preset', () => {
    const html = highlightCode('public class Main { return; }', 'java')
    expect(html).toContain('sh__token--keyword')
    expect(html).toContain('public')
  })

  test('highlights a Mermaid diagram source with its own grammar', () => {
    const source = 'flowchart LR\n  %% a note\n  A["Start"] --> B[Done]'
    const html = highlightCode(source, 'mermaid')
    expect(html).toMatch(/sh__token--keyword[^>]*>flowchart</)
    expect(html).toMatch(/sh__token--class[^>]*>LR</)
    expect(html).toContain('sh__token--comment')
    expect(html).toContain('sh__token--string')
    // `%%` is Mermaid's comment, not the JavaScript `//` the default grammar would look for.
    expect(highlightCode('A --> B // x', 'mermaid')).not.toContain('sh__token--comment')
  })

  test('uses the default grammar only for JavaScript-family language ids', () => {
    const html = highlightCode('const value = true', 'typescript')
    expect(html).toContain('sh__token--keyword')
    expect(html).toContain('const')
  })

  test('highlights radar and treemap definitions instead of treating them as scripts', () => {
    expect(highlightCode('radar-beta\naxis A, B, C\ncurve Example{1,2,3}', 'mermaid')).toMatch(
      /sh__token--keyword[^>]*>radar</,
    )
    expect(highlightCode('treemap-beta\n"Project"\n  "Build": 70', 'mermaid')).toMatch(
      /sh__token--keyword[^>]*>treemap</,
    )
  })

  test('keeps unknown and unlabeled fences escaped plain text', () => {
    const code = 'return "<service>&";'

    expect(highlightCode(code, 'klingon')).toBe('return &quot;&lt;service&gt;&amp;&quot;;')
    expect(highlightCode(code)).toBe('return &quot;&lt;service&gt;&amp;&quot;;')
    expect(highlightCode(code, 'klingon')).not.toContain('sh__token')
  })

  test('skips tokenization for oversized blocks', () => {
    const code = `${'const value = "<unsafe>";\n'.repeat(5_500)}const tail = true`
    const html = highlightCode(code, 'typescript')

    expect(html).not.toContain('sh__token')
    expect(html).toContain('&lt;unsafe&gt;')
    expect(html).toContain('const tail = true')
  })

  test('skips tokenization at the exact size boundary', () => {
    const code = `${'const value = true;\n'.repeat(6_736)}const value = true`.slice(0, 128_000)
    expect(code).toHaveLength(128_000)

    const html = highlightCode(code, 'typescript')

    expect(html).not.toContain('sh__token')
  })
})
