import { describe, expect, test } from 'bun:test'
import { parseInline, spansToText, type InlineSpan } from './markdown/inline'
import { parseMarkdownBlocks, firstTableBlock, type Block } from './markdown/blocks'

/**
 * Narrow a Block to the variants that carry inline spans (heading/paragraph/
 * blockquote). The old `as { spans: never[] }` cast asserted a shape no Block has;
 * this throws on the wrong variant, so a block that stops carrying spans fails here
 * instead of quietly comparing against an empty string.
 */
function spansOf(block: Block | undefined): InlineSpan[] {
  if (!block || !('spans' in block))
    throw new Error(`expected a block with spans, got: ${block?.type ?? 'none'}`)
  return block.spans
}

describe('parseInline', () => {
  test('parses bold, italic, and code spans', () => {
    const spans = parseInline('a **bold** and *italic* and `code` end')
    expect(spansToText(spans)).toBe('a bold and italic and code end')
    expect(spans.find((s) => s.text === 'bold')?.bold).toBe(true)
    expect(spans.find((s) => s.text === 'italic')?.italic).toBe(true)
    expect(spans.find((s) => s.text === 'code')?.code).toBe(true)
  })

  test('flattens links to text (url) and images to alt', () => {
    expect(spansToText(parseInline('see [docs](https://x.dev)'))).toBe('see docs (https://x.dev)')
    expect(spansToText(parseInline('![logo](a.png) here'))).toBe('logo here')
  })

  test('never throws on unmatched markers and always returns a span', () => {
    expect(parseInline('').length).toBe(1)
    expect(spansToText(parseInline('a **unclosed'))).toBe('a unclosed')
  })
})

describe('parseMarkdownBlocks', () => {
  test('parses headings with levels', () => {
    const blocks = parseMarkdownBlocks('# Title\n\n### Sub')
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 1 })
    expect(spansToText(spansOf(blocks[0]))).toBe('Title')
    expect(blocks[1]).toMatchObject({ type: 'heading', level: 3 })
  })

  test('groups consecutive lines into one paragraph, split on blanks', () => {
    const blocks = parseMarkdownBlocks('one\ntwo\n\nthree')
    const paras = blocks.filter((b) => b.type === 'paragraph')
    expect(paras).toHaveLength(2)
    expect(spansToText(spansOf(paras[0]))).toBe('one two')
  })

  test('parses unordered and ordered lists', () => {
    const ul = parseMarkdownBlocks('- a\n- b\n- c')[0]
    expect(ul).toMatchObject({ type: 'list', ordered: false })
    expect((ul as { items: unknown[] }).items).toHaveLength(3)

    const ol = parseMarkdownBlocks('1. one\n2. two')[0]
    expect(ol).toMatchObject({ type: 'list', ordered: true })
  })

  test('parses a GFM pipe table', () => {
    const table = firstTableBlock('| Name | Age |\n| --- | --- |\n| Ann | 30 |\n| Bob | 25 |')
    expect(table).not.toBeNull()
    expect(table!.header).toEqual(['Name', 'Age'])
    expect(table!.rows).toEqual([
      ['Ann', '30'],
      ['Bob', '25'],
    ])
  })

  test('parses fenced code blocks and horizontal rules', () => {
    const blocks = parseMarkdownBlocks('```ts\nconst x = 1\n```\n\n---')
    expect(blocks[0]).toMatchObject({ type: 'code', lang: 'ts', text: 'const x = 1' })
    expect(blocks[1]).toMatchObject({ type: 'hr' })
  })

  test('parses block-quotes', () => {
    const blocks = parseMarkdownBlocks('> quoted line\n> continued')
    expect(blocks[0]).toMatchObject({ type: 'blockquote' })
    expect(spansToText(spansOf(blocks[0]))).toBe('quoted line continued')
  })
})
