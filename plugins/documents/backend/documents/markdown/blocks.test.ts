import { describe, expect, it } from 'bun:test'

import { firstTableBlock, parseMarkdownBlocks } from './blocks'

/**
 * Behavior lock for the Markdown block parser that feeds the docx + pdf
 * generators (and, via firstTableBlock, xlsx-from-Markdown). Pins the pragmatic
 * subset — headings, paragraphs, lists, GFM tables, fenced code, quotes, rules —
 * and the "never throws, never drops content" contract.
 */
describe('parseMarkdownBlocks', () => {
  it('parses headings with their level', () => {
    expect(parseMarkdownBlocks('# Title')).toEqual([
      { type: 'heading', level: 1, spans: [{ text: 'Title' }] },
    ])
    expect(parseMarkdownBlocks('### H3')[0]).toMatchObject({ type: 'heading', level: 3 })
  })

  it('joins wrapped lines into one paragraph and splits on a blank line', () => {
    expect(parseMarkdownBlocks('a\nb')).toEqual([{ type: 'paragraph', spans: [{ text: 'a b' }] }])
    const two = parseMarkdownBlocks('one\n\ntwo')
    expect(two.map((b) => b.type)).toEqual(['paragraph', 'paragraph'])
  })

  it('parses unordered and ordered lists, one item per line', () => {
    expect(parseMarkdownBlocks('- one\n- two')).toEqual([
      { type: 'list', ordered: false, items: [[{ text: 'one' }], [{ text: 'two' }]] },
    ])
    expect(parseMarkdownBlocks('1. a\n2. b')).toMatchObject([{ type: 'list', ordered: true }])
  })

  it('parses a horizontal rule (not a list bullet)', () => {
    expect(parseMarkdownBlocks('---')).toEqual([{ type: 'hr' }])
  })

  it('parses a fenced code block with its language, verbatim inner text', () => {
    const md = ['```js', 'if (a && b) {}', '```'].join('\n')
    expect(parseMarkdownBlocks(md)).toEqual([{ type: 'code', text: 'if (a && b) {}', lang: 'js' }])
  })

  it('leaves a never-closed fence as a single code block (no throw, no drop)', () => {
    const md = ['```', 'line1', 'line2'].join('\n')
    expect(parseMarkdownBlocks(md)).toEqual([{ type: 'code', text: 'line1\nline2' }])
  })

  it('parses a GFM pipe table with tolerant edge pipes', () => {
    const md = ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n')
    expect(parseMarkdownBlocks(md)).toEqual([
      { type: 'table', header: ['a', 'b'], rows: [['1', '2']] },
    ])
  })

  it('accepts alignment colons and loose spacing in the separator row', () => {
    const md = ['a | b | c', ':--- | :--: | ---:', '1 | 2 | 3'].join('\n')
    expect(parseMarkdownBlocks(md)).toMatchObject([{ type: 'table', header: ['a', 'b', 'c'] }])
  })

  it('does not mistake a dashes-and-spaces line for a table separator', () => {
    // Header-looking line followed by a NON-separator: stays paragraphs, no table.
    const md = ['a | b', '   ---- ! ----   '].join('\n')
    expect(parseMarkdownBlocks(md).every((b) => b.type !== 'table')).toBe(true)
  })

  it('a pathological separator-ish line parses fast (no catastrophic backtracking)', () => {
    // Header + a huge "spaces then dashes then junk" line: the old TABLE_SEP_RE backtracked
    // quadratically here (~1.7s at 40k chars). Linear form must shrug it off.
    const md = ['a | b', `${' '.repeat(60_000)}${'-'.repeat(60_000)}!`].join('\n')
    const t0 = performance.now()
    parseMarkdownBlocks(md)
    expect(performance.now() - t0).toBeLessThan(250)
  })

  it('parses consecutive block-quote lines into one quote', () => {
    expect(parseMarkdownBlocks('> a\n> b')).toEqual([
      { type: 'blockquote', spans: [{ text: 'a b' }] },
    ])
  })

  it('treats unrecognized content as a paragraph', () => {
    expect(parseMarkdownBlocks('just some text')).toMatchObject([{ type: 'paragraph' }])
  })
})

describe('firstTableBlock', () => {
  it('returns the first table, or null when there is none', () => {
    const md = ['intro', '', '| a | b |', '| - | - |', '| 1 | 2 |'].join('\n')
    expect(firstTableBlock(md)).toEqual({ type: 'table', header: ['a', 'b'], rows: [['1', '2']] })
    expect(firstTableBlock('no table here')).toBeNull()
  })
})
