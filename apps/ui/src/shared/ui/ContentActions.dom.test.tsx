import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { ActionSurfaceProvider, type ActionContext } from '@localixai/mini-app-sdk/ui'
import { WorkItemSessionProvider } from '@localixai/mini-app-sdk/ui/work-item-session'
import { bindPluginUiTestDoubles } from '@localixai/mini-app-sdk/ui/testing'
import { registerAction, removeActionsOf } from '@/shared/contrib/actions'
import { setEnabledPluginNames } from '@/shared/contrib/pluginActivation'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('answer fragments offer exact source, native targets and owning session; streaming and other surfaces stay quiet', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { default: MarkdownRendererImpl } = await import('./MarkdownRendererImpl')
  const received: ActionContext[] = []
  const unbind = bindPluginUiTestDoubles()
  setEnabledPluginNames(new Set(['fragment-fixture']))
  registerAction({
    id: 'fragment-fixture:save',
    pluginName: 'fragment-fixture',
    label: 'Save fragment',
    Icon: () => null,
    when: (context) => context.surface === 'chat.content',
    run: async (context) => {
      received.push(context)
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const source =
    '## Heading\n\nA **formatted** paragraph.\n\n- first\n- second\n\n> [!TIP] Read\n> Preserve **this**.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconst n = 1\n```\n\n![Picture](https://example.com/image.png)\n\n[Image link](https://example.com/image.webp?q=1) [File](src/main.ts#L12)' +
    '\n\n> [!STEPS]\n> 1. **One**\n> 2. **Two**\n\n> [!PROS]\n- fast\n\n> [!CONS]\n- costly' +
    '\n\n```tree\nproject/\n├── README.md\n└── src/\n    └── app.ts # entry\n```' +
    '\n\n> [!TABS] Install\n#### **macOS**\nUse brew.\n#### *Linux*\nUse apt.\n\n---' +
    '\n\n> [!STATS] Results\n- **3×** faster\n- **40%** smaller'
  const render = async (surface: string | null, streaming = false) =>
    act(async () =>
      root.render(
        <WorkItemSessionProvider sessionId="origin-chat">
          <ActionSurfaceProvider surface={surface}>
            <MarkdownRendererImpl isStreaming={streaming}>{source}</MarkdownRendererImpl>
          </ActionSurfaceProvider>
        </WorkItemSessionProvider>,
      ),
    )
  try {
    await render('chat.content')
    const buttons = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button[aria-label="Save fragment"]'),
    )
    expect(buttons.length).toBeGreaterThanOrEqual(9)
    for (const button of buttons) await act(async () => button.click())
    expect(
      received.every(
        (context) => context.sessionId === 'origin-chat' && context.surface === 'chat.content',
      ),
    ).toBe(true)
    const targets = received.map((context) => context.target)
    expect(targets).toContainEqual({ kind: 'markdown', block: 'heading', markdown: '## Heading' })
    expect(targets).toContainEqual({
      kind: 'markdown',
      block: 'paragraph',
      markdown: 'A **formatted** paragraph.',
    })
    expect(targets).toContainEqual({
      kind: 'markdown',
      block: 'list',
      markdown: '- first\n- second',
    })
    expect(targets).toContainEqual({
      kind: 'markdown',
      block: 'callout',
      markdown: '> [!TIP] Read\n> Preserve **this**.',
    })
    expect(targets).toContainEqual({
      kind: 'table',
      markdown: '| A | B |\n| --- | --- |\n| 1 | 2 |',
    })
    expect(targets).toContainEqual({ kind: 'code', text: 'const n = 1', language: 'ts' })
    expect(targets).toContainEqual({
      kind: 'image',
      src: 'https://example.com/image.png',
      alt: 'Picture',
    })
    expect(targets).toContainEqual({ kind: 'file', path: 'src/main.ts', line: 12, title: 'File' })
    expect(targets).toContainEqual({
      kind: 'link',
      url: 'https://example.com/image.webp?q=1',
      title: 'Image link',
    })
    // An answer form is copied as the whole form, marker included — shaped from a quote's
    // inner list, it used to be copied from that list on, half quoted and with no marker.
    expect(targets).toContainEqual({
      kind: 'markdown',
      block: 'list',
      markdown: '> [!STEPS]\n> 1. **One**\n> 2. **Two**',
    })
    expect(targets).toContainEqual({
      kind: 'markdown',
      block: 'other',
      markdown: '> [!PROS]\n- fast\n\n> [!CONS]\n- costly',
    })
    expect(targets).toContainEqual({
      kind: 'markdown',
      block: 'other',
      markdown: '```tree\nproject/\n├── README.md\n└── src/\n    └── app.ts # entry\n```',
    })
    expect(targets).toContainEqual({
      kind: 'markdown',
      block: 'other',
      markdown: '> [!TABS] Install\n#### **macOS**\nUse brew.\n#### *Linux*\nUse apt.',
    })
    expect(targets).toContainEqual({
      kind: 'markdown',
      block: 'other',
      markdown: '> [!STATS] Results\n- **3×** faster\n- **40%** smaller',
    })
    await render('chat.content', true)
    expect(host.querySelector('button[aria-label="Save fragment"]')).toBeNull()
    await render(null)
    expect(host.querySelector('button[aria-label="Save fragment"]')).toBeNull()
    await render('board.element')
    expect(host.querySelector('button[aria-label="Save fragment"]')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
    removeActionsOf('fragment-fixture')
    setEnabledPluginNames(null)
    unbind()
  }
})
