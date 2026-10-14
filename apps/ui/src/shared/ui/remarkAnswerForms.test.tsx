import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import MarkdownRendererImpl from './MarkdownRendererImpl'
import { TaskScope, toggleTaskInSource } from './MarkdownTaskList'

const STORED = { 'content:0': true }
import { parseFileTree } from '@localixai/markdown/fileTreeParse'
import { ANSWER_FORM_EXAMPLES } from '@localixai/markdown/dialect'

const render = (markdown: string) =>
  renderToStaticMarkup(<MarkdownRendererImpl>{markdown}</MarkdownRendererImpl>)

describe('tabs (`> [!TABS]` with a heading per variant)', () => {
  const TABS = [
    '> [!TABS]',
    '> #### macOS',
    '> brew install localix',
    '> #### Linux',
    '> curl -fsSL get.localix.sh | sh',
  ].join('\n')

  test('each heading becomes a tab, the first shown and the rest kept in the DOM', () => {
    const html = render(TABS)
    expect(html).toContain('class="lx-tabs"')
    expect(html).toContain('macOS')
    expect(html).toContain('Linux')
    // Every panel is rendered — hidden ones too — so find-in-page and copy still reach them.
    expect(html).toContain('brew install localix')
    expect(html).toContain('curl -fsSL get.localix.sh | sh')
    expect(html.match(/role="tabpanel"/g)?.length).toBe(2)
    expect(html.match(/hidden=""/g)?.length).toBe(1)
    expect(html).not.toContain('[!TABS]')
  })

  test('without a heading under the marker it stays the quote it was written as', () => {
    expect(render('> [!TABS]\n> just text')).toContain('<blockquote')
  })

  test('formatted headings retain their complete tab label', () => {
    const html = render(
      '> [!TABS]\n#### **macOS** `arm64`\nOne.\n#### [Linux](https://example.com)\nTwo.',
    )
    expect(html).toContain('<span>macOS arm64</span>')
    expect(html).toContain('<span>Linux</span>')
  })
})

describe('headline figures (`> [!STATS]`)', () => {
  test('each item is its bold value over its label', () => {
    const html = render('> [!STATS]\n> - **3×** faster builds\n> - **−40%** memory')
    expect(html).toContain('<ul class="lx-stats">')
    expect(html).toContain(
      '<div class="lx-stat"><span class="lx-stat-value">3×</span><span class="lx-stat-label">faster builds</span></div>',
    )
  })
})

describe('the case for and against (`> [!PROS]` / `> [!CONS]`)', () => {
  test('written one after the other, the two are paired side by side', () => {
    const html = render('> [!PROS]\n> - fast\n\n> [!CONS]\n> - costly')
    expect(html).toContain('<div class="lx-verdicts">')
    expect(html).toContain('<aside class="lx-verdict" data-verdict="pros">')
    expect(html).toContain('<aside class="lx-verdict" data-verdict="cons">')
    expect(html.indexOf('data-verdict="pros"')).toBeLessThan(html.indexOf('data-verdict="cons"'))
  })

  test('alone, a side is its own aside, with the title the author wrote', () => {
    const html = render('> [!CONS] Risks\n> - lock-in')
    expect(html).not.toContain('lx-verdicts')
    expect(html).toContain('<p class="lx-verdict-title">Risks</p>')
  })
})

describe('file tree (a ```tree fence)', () => {
  const TREE = ['src/', '├── app.ts        # entry point', '└── features/', '    └── chat/'].join(
    '\n',
  )

  test('depth, folders and comments are read off the drawing', () => {
    expect(parseFileTree(TREE)).toMatchObject([
      { depth: 0, name: 'src/', comment: '', folder: true, parent: null },
      { depth: 1, name: 'app.ts', comment: 'entry point', folder: false, parent: 0 },
      { depth: 1, name: 'features/', comment: '', folder: true, parent: 0 },
      { depth: 2, name: 'chat/', comment: '', folder: true, parent: 2 },
    ])
    // A path per row is the key a fold and the arrow keys use.
    expect(parseFileTree(TREE)[3]!.path).toBe('src/features/chat/#3')
  })

  test('folders are foldable treeitems with the sidebar’s file-type glyphs', () => {
    const html = render(`\`\`\`tree\n${TREE}\n\`\`\``)
    expect(html.match(/aria-expanded="true"/g)?.length).toBe(3)
    expect(html).toContain('data-tree-path="src/app.ts#1"')
  })

  test('renders as a tree of rows rather than box characters in a code block', () => {
    const html = render(`\`\`\`tree\n${TREE}\n\`\`\``)
    expect(html).toContain('role="tree"')
    expect(html).toMatch(
      /<span class="lx-tree-comment[^"]*" title="entry point">entry point<\/span>/,
    )
    expect(html).not.toContain('├──')
  })
})

describe('checklists (GFM `- [ ] item`)', () => {
  const LIST = '- [ ] backup the database\n- [x] tag the release'

  test('outside a message the boxes show their source state and cannot be ticked', () => {
    const html = render(LIST)
    expect(html.match(/data-slot="checkbox"/g)?.length).toBe(2)
    expect(html.match(/disabled=""/g)?.length).toBe(2)
  })

  test('in a reply the stored mark wins over the source, and the box is live', () => {
    const html = renderToStaticMarkup(
      // `content:0` — the first item starts the text; the key is its source offset.
      <TaskScope messageId="m1" scope="content" states={STORED}>
        <MarkdownRendererImpl>{LIST}</MarkdownRendererImpl>
      </TaskScope>,
    )
    // Outside a chat surface there is no session to store on, so it stays read-only here; the
    // stored state is still what it shows.
    expect(html.match(/checked=""/g)?.length).toBe(2)
  })

  test('where the text is the store (a board), a box is live and a tick rewrites its item', () => {
    const html = renderToStaticMarkup(
      <MarkdownRendererImpl onSourceChange={() => {}}>{LIST}</MarkdownRendererImpl>,
    )
    expect(html.match(/data-slot="checkbox"/g)?.length).toBe(2)
    expect(html).not.toContain('disabled=""')
    const second = LIST.indexOf('- [x]')
    expect(toggleTaskInSource(LIST, 0, true)).toBe(
      '- [x] backup the database\n- [x] tag the release',
    )
    expect(toggleTaskInSource(LIST, second, false)).toBe(
      '- [ ] backup the database\n- [ ] tag the release',
    )
    // Inside a quote the item starts at its bullet, after the `> `; a non-item offset is refused.
    expect(toggleTaskInSource('> - [ ] a', 2, true)).toBe('> - [x] a')
    expect(toggleTaskInSource(LIST, 3, true)).toBeNull()
  })
})

/**
 * What models actually write: the marker as a one-line quote, then the content UNQUOTED. Markdown
 * ends a quote at a heading or a list, so read literally the marker governed nothing — both cases
 * below are verbatim from a live session where every form rendered as a stray `[!TABS]` line.
 */
describe('a marker-only quote governs the blocks right after it', () => {
  test('tabs: the unquoted headings that follow become the tabs', () => {
    const html = render(
      '> [!TABS]\n#### macOS\nUse fnm.\n\n```sh\nfnm install --lts\n```\n\n#### Linux\nSame on Linux.',
    )
    expect(html).toContain('class="lx-tabs"')
    expect(html).not.toContain('[!TABS]')
    expect(html.match(/role="tabpanel"/g)?.length).toBe(2)
  })

  test('pros/cons inside those tabs are shaped too, each taking the list after it', () => {
    const html = render(
      [
        '> [!TABS]',
        '#### PostgreSQL',
        '> [!PROS]',
        '- concurrent writes',
        '',
        '> [!CONS]',
        '- needs a server',
        '',
        '#### SQLite',
        '> [!PROS]',
        '- one file',
      ].join('\n'),
    )
    expect(html.match(/role="tabpanel"/g)?.length).toBe(2)
    expect(html).toContain('<div class="lx-verdicts">')
    expect(html).not.toContain('[!PROS]')
    expect(html).not.toContain('[!CONS]')
  })

  test('a list form takes only the ONE list after it; prose after the tabs ends at `---`', () => {
    const steps = render('> [!STEPS]\n1. **Day 1**\n   Rest.\n\nAfterwards, walk.')
    expect(steps).toContain('class="lx-steps"')
    expect(steps).toContain('<p>Afterwards, walk.</p>')
    const tabs = render('> [!TABS]\n#### A\nOne.\n\n---\n\nAfter.')
    expect(tabs.indexOf('After.')).toBeGreaterThan(tabs.lastIndexOf('role="tabpanel"'))
  })

  test('every example the prompt shows renders as its form, with no marker left as text', () => {
    const expected: Record<keyof typeof ANSWER_FORM_EXAMPLES, string[]> = {
      comparison: ['class="lx-tabs"', '<div class="lx-verdicts">'],
      verdict: ['<div class="lx-verdicts">'],
      steps: ['class="lx-steps"', 'lx-step-title'],
      stats: ['<ul class="lx-stats">', 'lx-stat-value'],
    }
    for (const [form, lines] of Object.entries(ANSWER_FORM_EXAMPLES)) {
      const html = render(lines.join('\n'))
      for (const fragment of expected[form as keyof typeof expected])
        expect(html, form).toContain(fragment)
      expect(html, form).not.toContain('[!')
    }
  })

  test('a marker with nothing it can govern still stays a quote', () => {
    expect(render('> [!STATS]\n\nJust prose.')).toContain('<blockquote')
  })
})

describe('a reply that also carries raw HTML', () => {
  test('keeps the dialect: callouts and timelines survive the sanitizer', () => {
    const html = render(
      '<b>note</b>\n\n> [!STEPS]\n> 1. **Day 1**\n>    Rest.\n\n> [!TIP]\n> Cache it.',
    )
    expect(html).toContain('class="lx-steps"')
    expect(html).toContain('lx-step-title')
    expect(html).toContain('data-callout="tip"')
  })
})
