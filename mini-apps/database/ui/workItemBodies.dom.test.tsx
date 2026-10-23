import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import '@localixai/kit/testing/host-runtime'
import { registerDom } from '@localixai/kit/testing'
import { miniAppRealtime } from '@localixai/mini-app-sdk/ui/runtime'
import type { PublishMessageContext, WorkItemLike } from '@localixai/mini-app-sdk/ui'

let teardown: () => Promise<void>
let restoreEditor: () => void
let originalFetch: typeof fetch
const realtimeMethods = { ...miniAppRealtime }

beforeAll(async () => {
  teardown = registerDom()
  // Monaco's worker does not load under the DOM preload; the consoles' routing is what is tested.
  const codeEditor = await import('@localixai/kit/code-editor')
  const editor = spyOn(codeEditor, 'CodeEditor').mockImplementation(({ ariaLabel }) => (
    <textarea aria-label={ariaLabel} />
  ))
  restoreEditor = () => editor.mockRestore()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Object.assign(miniAppRealtime, {
    onFrame: () => () => {},
    onReconnect: () => () => {},
    onDisconnect: () => () => {},
    request: async () => ({ subscribed: false }),
  })
  originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body = url.endsWith('/schemas') ? { schemas: {} } : {}
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
})

afterAll(async () => {
  restoreEditor()
  Object.assign(miniAppRealtime, realtimeMethods)
  globalThis.fetch = originalFetch
  await teardown()
})

const consoleItem = (dialect: string): WorkItemLike => ({
  id: `database:console:${dialect}`,
  kind: 'database:console',
  title: `${dialect} console`,
  payload: { connectionId: `conn-${dialect}`, dialect },
})

describe('DbConsoleBody', () => {
  test('without a chat, the console says so instead of guessing one', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { DbConsoleBody } = await import('./workItemBodies')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(<DbConsoleBody item={consoleItem('redis')} publishMessageContext={() => {}} />)
      })
      expect(host.textContent).toContain('Open the database from a chat.')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  // Each console publishes its draft under its own noun, which names the console that mounted and
  // proves it got the tab's title and publisher.
  test.each([
    ['redis', './KvConsoleTab', 'command draft'],
    ['mongodb', './DocConsoleTab', 'document query draft'],
    ['elasticsearch', './EsConsoleTab', 'search draft'],
    ['sqlite', './DbConsoleTab', 'SQL draft'],
  ])('a %s console mounts %s', async (dialect, module, noun) => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { WorkItemSessionProvider } = await import('@localixai/mini-app-sdk/ui/work-item-session')
    const { DbConsoleBody } = await import('./workItemBodies')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const published: Parameters<PublishMessageContext>[0][] = []
    try {
      await act(async () => {
        root.render(
          <WorkItemSessionProvider sessionId="chat-a">
            <DbConsoleBody
              item={consoleItem(dialect)}
              publishMessageContext={(context) => published.push(context)}
            />
          </WorkItemSessionProvider>,
        )
        await import(module)
      })
      const labels = published.flatMap((context) =>
        (context?.bindings ?? []).map((binding) => binding.target.label),
      )
      expect(labels).toContain(`${dialect} console ${noun}`)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
