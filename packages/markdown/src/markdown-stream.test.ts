import { describe, expect, test } from 'bun:test'
import { fenceScanStats } from './markdown-fence-scan'
import { closePartialMarkdown, openFenceBody, isGrowingFence } from './markdown-stream'

describe('closePartialMarkdown math', () => {
  test('withholds a formula still being typed, from its opening dollar', () => {
    expect(closePartialMarkdown('Energy is $E = mc')).toBe('Energy is')
    expect(closePartialMarkdown('Then:\n$$\n\\frac{a}{')).toBe('Then:')
    expect(closePartialMarkdown('Done $a$ and $b')).toBe('Done $a$ and')
  })

  test('keeps a closed formula, currency and shell variables as they are', () => {
    expect(closePartialMarkdown('Energy is $E = mc^2$ here')).toBe('Energy is $E = mc^2$ here')
    expect(closePartialMarkdown('It costs $5 today')).toBe('It costs $5 today')
    expect(closePartialMarkdown('Set $HOME/bin first')).toBe('Set $HOME/bin first')
    expect(closePartialMarkdown('Export $PATH before')).toBe('Export $PATH before')
    expect(closePartialMarkdown('Escaped \\$x stays')).toBe('Escaped \\$x stays')
    expect(closePartialMarkdown('In code `echo $x` only')).toBe('In code `echo $x` only')
  })

  test('a * or _ inside a closed formula is not an open emphasis', () => {
    expect(closePartialMarkdown('Product $a*b$ and $x_i$ done')).toBe(
      'Product $a*b$ and $x_i$ done',
    )
  })
})

describe('closePartialMarkdown callout markers', () => {
  test('hides a callout marker still being typed, keeps a complete one', () => {
    expect(closePartialMarkdown('Intro\n\n> [!WARN')).toBe('Intro\n')
    expect(closePartialMarkdown('Intro\n\n> [!')).toBe('Intro\n')
    expect(closePartialMarkdown('> [')).toBe('')
    expect(closePartialMarkdown('Intro\n\n> [!WARNING]')).toBe('Intro\n\n> [!WARNING]')
  })

  test('leaves an ordinary quote or a bracket in prose alone', () => {
    expect(closePartialMarkdown('> quoted [text')).toBe('> quoted [text')
    expect(closePartialMarkdown('See [')).toBe('See [')
  })
})

describe('openFenceBody', () => {
  test('is the body of the one unterminated fence, and null once every fence is closed', () => {
    expect(openFenceBody('Intro\n```mermaid\nflowchart LR\n  A --> B')).toBe(
      'flowchart LR\n  A --> B',
    )
    expect(openFenceBody('```mermaid\n')).toBe('')
    expect(openFenceBody('```mermaid\nA --> B\n```\nThen prose.')).toBeNull()
    expect(openFenceBody('Plain prose')).toBeNull()
  })

  test('only the tail fence counts as growing: a closed diagram above it is drawn', () => {
    const text = '```mermaid\nA --> B\n```\n\nMore:\n```mermaid\nC --> D'
    const growing = openFenceBody(text)
    expect(isGrowingFence(growing, 'C --> D\n')).toBe(true)
    expect(isGrowingFence(growing, 'A --> B')).toBe(false)
    expect(isGrowingFence(null, 'A --> B')).toBe(false)
  })
})

describe('closePartialMarkdown', () => {
  test('plain complete text is returned verbatim', () => {
    const text = 'Hello **world**, see `code` and [a link](https://x.dev).'
    expect(closePartialMarkdown(text)).toBe(text)
  })

  test('empty string is returned as-is', () => {
    expect(closePartialMarkdown('')).toBe('')
  })

  test('closes an unterminated code fence', () => {
    expect(closePartialMarkdown('intro\n```ts\nconst a = 1')).toBe('intro\n```ts\nconst a = 1\n```')
  })

  test('closes an unterminated tilde fence with the same marker', () => {
    expect(closePartialMarkdown('~~~~\ncode')).toBe('~~~~\ncode\n~~~~')
  })

  test('leaves a terminated fence untouched', () => {
    const text = '```ts\nconst a = 1\n```\nafter'
    expect(closePartialMarkdown(text)).toBe(text)
  })

  test('skips inline fixes while inside a fence', () => {
    expect(closePartialMarkdown('```\na ** b')).toBe('```\na ** b\n```')
  })

  test('a shorter fence-like line does not close a longer opener', () => {
    expect(closePartialMarkdown('````\n```\ncode')).toBe('````\n```\ncode\n````')
  })

  test('closes a dangling bold span', () => {
    expect(closePartialMarkdown('this is **import')).toBe('this is **import**')
  })

  test('strips a bare trailing bold opener', () => {
    expect(closePartialMarkdown('this is **')).toBe('this is ')
  })

  test('closes a dangling strikethrough span', () => {
    expect(closePartialMarkdown('was ~~remov')).toBe('was ~~remov~~')
  })

  test('closes a dangling inline code span', () => {
    expect(closePartialMarkdown('call `fetchCata')).toBe('call `fetchCata`')
  })

  test('strips a bare trailing backtick opener', () => {
    expect(closePartialMarkdown('call `')).toBe('call ')
  })

  test('ignores ** inside inline code when balancing', () => {
    const text = 'the glob `**/*.ts` matches'
    expect(closePartialMarkdown(text)).toBe(text)
  })

  test('closes a half-typed link', () => {
    expect(closePartialMarkdown('see [docs](https://exa')).toBe('see [docs](https://exa)')
  })

  test('hides a half-typed image', () => {
    expect(closePartialMarkdown('look ![diagram](https://exa')).toBe('look ')
    expect(closePartialMarkdown('look ![diag')).toBe('look ')
  })

  test('only the last paragraph is touched', () => {
    expect(closePartialMarkdown('a ** b\n\nnow **bol')).toBe('a ** b\n\nnow **bol**')
  })

  test('balanced earlier paragraphs stay byte-identical', () => {
    const head = '**done** and `ok`\n\n'
    expect(closePartialMarkdown(`${head}tail `)).toBe(`${head}tail `)
  })

  test('escaped backticks are not counted', () => {
    const text = 'a literal \\` backtick'
    expect(closePartialMarkdown(text)).toBe(text)
  })

  // ── single-char emphasis (`*` / `_`) ──
  test('closes a dangling single-asterisk italic', () => {
    expect(closePartialMarkdown('this is *important')).toBe('this is *important*')
  })

  test('closes a dangling single-underscore italic', () => {
    expect(closePartialMarkdown('this is _important')).toBe('this is _important_')
  })

  test('strips a bare trailing single emphasis opener', () => {
    // Word-adjacent `*` is emphasis-capable; a bare trailing one is stripped
    // rather than closed (closing an empty pair would show two literal chars).
    expect(closePartialMarkdown('open intraword a*')).toBe('open intraword a')
  })

  test('leaves a whitespace-flanked lone asterisk alone', () => {
    // Not emphasis-capable (it never flashes), so don't strip a real literal.
    expect(closePartialMarkdown('a stray *')).toBe('a stray *')
  })

  test('leaves complete single emphasis untouched', () => {
    expect(closePartialMarkdown('an *italic* word')).toBe('an *italic* word')
    expect(closePartialMarkdown('an _italic_ word')).toBe('an _italic_ word')
  })

  test('does not touch a multiplication asterisk', () => {
    expect(closePartialMarkdown('compute 2 * 3 now')).toBe('compute 2 * 3 now')
  })

  test('does not touch a glob asterisk', () => {
    expect(closePartialMarkdown('match *.ts files')).toBe('match *.ts files')
  })

  test('does not touch a trailing bullet marker', () => {
    expect(closePartialMarkdown('list:\n\n* ')).toBe('list:\n\n* ')
  })

  test('does not touch intraword underscores', () => {
    expect(closePartialMarkdown('the file_name var')).toBe('the file_name var')
    expect(closePartialMarkdown('python __init__ dunder')).toBe('python __init__ dunder')
    expect(closePartialMarkdown('a snake_case_var here')).toBe('a snake_case_var here')
  })

  test('ignores single emphasis chars inside inline code', () => {
    const text = 'see `a * b` and `x_y`'
    expect(closePartialMarkdown(text)).toBe(text)
  })

  test('does not double-count ** when balancing single asterisks', () => {
    expect(closePartialMarkdown('**bold** then *it')).toBe('**bold** then *it*')
  })

  // ── partial table rows ──
  test('hides a half-typed trailing table row', () => {
    expect(closePartialMarkdown('| A | B |\n| --- | --- |\n| 1 |')).toBe('| A | B |\n| --- | --- |')
  })

  test('does not hide pipe-prefixed prose or a table header before its separator', () => {
    expect(closePartialMarkdown('| literal')).toBe('| literal')
    expect(closePartialMarkdown('intro\n\n| quoted prose')).toBe('intro\n\n| quoted prose')
    expect(closePartialMarkdown('| A | B |')).toBe('| A | B |')
    expect(closePartialMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |\n\n| prose')).toBe(
      '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n| prose',
    )
  })

  test('keeps a completed table row (ends in newline)', () => {
    const text = '| A | B |\n| --- | --- |\n| 1 | 2 |\n'
    expect(closePartialMarkdown(text)).toBe(text)
  })
})

describe('openFenceBody incremental scan', () => {
  test('matches a fresh scan while text grows token by token and after unrelated texts', () => {
    const reply =
      'Intro\n\n```ts\nconst a = 1\n```\n\nMore\n~~~~\ncode\n~~~ x\n~~~~\nend\n```\nlast'
    for (let i = 0; i <= reply.length; i += 1) {
      const text = reply.slice(0, i)
      openFenceBody('unrelated\n```\nbody') // reset the cached prefix between calls
      const fresh = openFenceBody(text)
      for (let j = 0; j <= i; j += 1) openFenceBody(reply.slice(0, j))
      expect(openFenceBody(text)).toBe(fresh)
    }
    expect(openFenceBody(reply)).toBe('last')
    expect(openFenceBody('```')).toBe('')
    expect(openFenceBody('```\n```')).toBeNull()
  })

  test('stays linear on a long streamed reply', () => {
    // Counts scanned lines instead of timing: wall-clock budgets flake on shared CI runners.
    const line = 'word '.repeat(20) + '\n'
    const lines = 2_000
    openFenceBody('reset')
    const before = fenceScanStats.lines
    let text = '```\n'
    for (let i = 0; i < lines; i += 1) {
      text += line
      closePartialMarkdown(text)
    }
    // A rescan from the start on every call would scan about lines² / 2.
    expect(fenceScanStats.lines - before).toBeLessThanOrEqual(lines + 1)
  })
})
