import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkItemSessionProvider } from '@localixai/mini-app-sdk/ui/work-item-session'
import MarkdownRendererImpl from './MarkdownRendererImpl'
import { classifyMarkdownLink, markdownUrlTransform } from './markdownLink'
import { TaskScope, toggleTaskInSource } from './MarkdownTaskList'

const STORED = { 'content:0': true }

const render = (markdown: string) =>
  renderToStaticMarkup(<MarkdownRendererImpl>{markdown}</MarkdownRendererImpl>)

describe('links', () => {
  test('keeps sandbox artifact links clickable without weakening URL sanitization', () => {
    const fileName =
      '\u041f\u043b\u0430\u043d_\u0442\u0440\u0435\u043d\u0438\u0440\u043e\u0432\u043e\u043a_' +
      '\u0434\u043b\u044f_\u043f\u043e\u0445\u0443\u0434\u0435\u043d\u0438\u044f.pdf'
    const href = `sandbox:/Users/me/.localix/workspace/LOCALIX-7/${fileName}`
    const label =
      '\u0421\u043a\u0430\u0447\u0430\u0442\u044c PDF-\u043f\u043b\u0430\u043d ' +
      '\u0442\u0440\u0435\u043d\u0438\u0440\u043e\u0432\u043e\u043a'
    expect(markdownUrlTransform(href, 'href')).toBe(href)
    expect(markdownUrlTransform(href, 'src')).toBeUndefined()
    expect(markdownUrlTransform('javascript:alert(1)', 'href')).toBeUndefined()

    const html = renderToStaticMarkup(
      <WorkItemSessionProvider sessionId="s1">
        <MarkdownRendererImpl>{`[${label}](${href})`}</MarkdownRendererImpl>
      </WorkItemSessionProvider>,
    )
    expect(html).not.toContain('href=""')
    expect(html).toContain('href="sandbox:/Users/me/.localix/workspace/LOCALIX-7/')
    expect(html).toContain('title="Open /Users/me/.localix/workspace/LOCALIX-7/')
  })
})

describe('code', () => {
  test('a settled fence is highlighted by the workspace code block', () => {
    expect(render('```ts\nconst answer = 42\n```')).toContain('sh__token--keyword')
  })

  test('a long reply is one paragraph of text, not one element per word', () => {
    const text = Array.from({ length: 1_000 }, (_, index) => `word-${index}`).join(' ')
    expect(render(text).match(/<span/g)).toBeNull()
  })

  test('a settled mermaid fence holds a pending frame, never raw source, until it is drawn', () => {
    const html = render('```mermaid\nflowchart LR\n  A --> B\n```')
    expect(html).toContain('Drawing diagram')
    expect(html).not.toContain('A --&gt; B')
  })
})

describe('file tree (a ```tree fence)', () => {
  test('is the foldable, keyboard-walked tree, not box characters in a code block', () => {
    const tree = ['src/', '├── app.ts        # entry point', '└── features/', '    └── chat/']
    const html = render(`\`\`\`tree\n${tree.join('\n')}\n\`\`\``)
    expect(html).toContain('role="tree"')
    expect(html.match(/aria-expanded="true"/g)?.length).toBe(3)
    expect(html).toContain('entry point')
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

describe('mention chips', () => {
  test('the renderer’s own chip schemes survive the URL transform', () => {
    // Before this, the transform stripped every scheme it had no click route for — including
    // the two our own Markdown extensions mint — so both chips silently rendered as plain text.
    expect(markdownUrlTransform('mention:src%2Fa.ts', 'href')).toBe('mention:src%2Fa.ts')
    expect(markdownUrlTransform('agent:qa', 'href')).toBe('agent:qa')
    expect(classifyMarkdownLink('agent:qa')).toEqual({ kind: 'chip', href: 'agent:qa' })
    // Still never an image source, and still nothing a page could smuggle in.
    expect(markdownUrlTransform('agent:qa', 'src')).toBeUndefined()
    expect(markdownUrlTransform('javascript:alert(1)', 'href')).toBeUndefined()
  })

  test('a file mention renders as a chip that opens the file — in its own chat only', () => {
    const html = renderToStaticMarkup(
      <WorkItemSessionProvider sessionId="s1">
        <MarkdownRendererImpl linkifyMentions>{'see @src/app.ts please'}</MarkdownRendererImpl>
      </WorkItemSessionProvider>,
    )
    expect(html).toContain('title="Open src/app.ts"')
    // Outside a chat there is no workspace to open it in: the chip is a disabled label.
    const orphan = renderToStaticMarkup(
      <MarkdownRendererImpl linkifyMentions>{'see @src/app.ts please'}</MarkdownRendererImpl>,
    )
    expect(orphan).not.toContain('title="Open src/app.ts"')
    expect(orphan).toContain('disabled=""')
  })
})
