import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ModClientFault, ModElement } from '@/shared/api/modsApi'
import type { ModClientScope as ScopeContext, ModClientScopeValue } from './ModClient'
import type { ModTree as TreeComponent } from './ModTree'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

// Each test its own revision: the module's code is cached by it.
const client = (props: Record<string, unknown>, revision = 'r1'): ModElement => ({
  type: 'Client',
  props: { key: 'wheel', module: 'hooks/client/wheel.tsx', ...props },
  children: [],
  client: { revision },
})

function transport(code: { code: string } | { problem: string }) {
  const calls = {
    messages: [] as unknown[],
    faults: [] as ModClientFault[],
  }
  const value: ModClientScopeValue['transport'] = {
    clientModule: async (_instance, module) => ({ module, revision: 'r1', ...code }),
    message: async (_instance, _pane, _key, data) => {
      calls.messages.push(data)
      return { props: { speed: 9 } }
    },
    fault: async (_instance, _pane, _key, fault) => void calls.faults.push(fault),
  }
  return { value, calls }
}

async function mount(
  element: ModElement,
  scope: Omit<ModClientScopeValue, 'transport'>,
  t: ReturnType<typeof transport>,
) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ModTree } = await import('./ModTree')
  const { ModClientScope } = await import('./ModClient')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = (next: ModElement, generation: number) =>
    act(async () =>
      root.render(
        <InPane
          Scope={ModClientScope}
          value={{ ...scope, generation, transport: t.value }}
          element={next}
          Tree={ModTree}
        />,
      ),
    )
  await render(element, scope.generation)
  // The module's code arrives.
  await act(async () => {})
  return { host, render, act, unmount: () => act(async () => root.unmount()) }
}

/** A pane's scope around one drawing, as `ModsWorkspace` provides it. */
function InPane(input: {
  Scope: typeof ScopeContext
  Tree: typeof TreeComponent
  value: ModClientScopeValue
  element: ModElement
}) {
  const { Scope, Tree } = input
  return (
    <Scope.Provider value={input.value}>
      <Tree nodes={[input.element]} act={() => {}} />
    </Scope.Provider>
  )
}

const SCOPE = { instance: 'spinner~1', pane: 'spin', plugin: 'spinner', generation: 0 }

test('a Client runs its module in an isolated frame and bridges posts to ui.message', async () => {
  const t = transport({ code: 'var wheel = 1' })
  const { host, render, act, unmount } = await mount(
    client({ props: { speed: 2 }, height: 3 }),
    SCOPE,
    t,
  )
  const frame = host.querySelector('iframe')!
  expect(frame).not.toBeNull()
  // Scripts only: an opaque origin, no same-origin, popups, forms or top navigation.
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
  const doc = frame.getAttribute('srcdoc')!
  expect(doc).toContain("default-src 'none'")
  expect(doc).toContain('"code":"var wheel = 1"')
  expect(doc).toContain('"props":{"speed":2}')

  const sent: unknown[] = []
  const frameWindow = frame.contentWindow!
  frameWindow.postMessage = ((message: unknown) => void sent.push(message)) as never
  const fromFrame = (type: string, payload?: unknown, source: unknown = frameWindow) =>
    act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { lx: 'mod-client', type, payload },
          source: source as never,
        }),
      )
    })

  await fromFrame('ready')
  expect(sent).toContainEqual({ lx: 'mod-client', type: 'props', payload: { speed: 2 } })

  await fromFrame('post', { faster: true })
  await act(async () => {})
  expect(t.calls.messages).toEqual([{ faster: true }])
  // The hook's answer reaches the instance without a redraw.
  expect(sent.at(-1)).toEqual({ lx: 'mod-client', type: 'props', payload: { speed: 9 } })

  // Another window's message is not this frame's.
  await fromFrame('post', { forged: true }, window)
  await act(async () => {})
  expect(t.calls.messages).toHaveLength(1)

  // A new drawing hands the running instance its props again, the frame kept.
  await render(client({ props: { speed: 4 }, height: 3 }), 1)
  expect(host.querySelector('iframe')).toBe(frame)
  expect(sent.at(-1)).toEqual({ lx: 'mod-client', type: 'props', payload: { speed: 4 } })

  await fromFrame('fault', { phase: 'render', reason: 'boom' })
  expect(host.querySelector('iframe')).toBeNull()
  expect(host.textContent).toContain('spinner: Client hooks/client/wheel.tsx: boom')
  expect(t.calls.faults).toEqual([{ phase: 'render', reason: 'boom' }])
  await unmount()
  host.remove()
})

test('a module that did not build is a load fault, drawn as a dim line', async () => {
  const t = transport({ problem: 'left-pad: a surface module imports only its plugin’s files' })
  const { host, unmount } = await mount(client({}, 'r2'), SCOPE, t)
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  expect(host.querySelector('iframe')).toBeNull()
  expect(host.textContent).toContain('left-pad')
  expect(t.calls.faults).toEqual([{ phase: 'load', reason: expect.stringContaining('left-pad') }])
  await unmount()
  host.remove()
})

test('outside a pane a Client says where it draws', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ModTree } = await import('./ModTree')
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(<ModTree nodes={[client({})]} act={() => {}} />))
  expect(host.textContent).toContain('only in a mod’s pane')
  expect(host.querySelector('iframe')).toBeNull()
  await act(async () => root.unmount())
})
