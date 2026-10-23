import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import {
  bindMiniAppUiComponents,
  MESSAGE_BINDING_MIME,
  readMessageBindingDrag,
  type MessageContextBindingDraft,
} from '@localixai/mini-app-sdk/ui'
import { CanvasProvider } from '@localixai/kit/canvas'
import { registerDom } from '@localixai/kit/testing'
import type { RefProps } from '../../shared/types/app-links'
import { viewOf } from './index'

/**
 * An app link card is the host's picture of the link under the link's own name, and a way back:
 * its grip drags out exactly the link that was dropped in, so a session taken from the chat to the
 * board goes back to the composer as that session.
 */
let teardown: () => Promise<void>
let unbind: () => void
const previewed: MessageContextBindingDraft[] = []
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
beforeAll(() => {
  teardown = registerDom()
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  const Empty = () => null
  unbind = bindMiniAppUiComponents({
    FileTab: Empty,
    TableGrid: Empty,
    ContextBindingIcon: Empty,
    ContextBindingPreview: ({ binding }) => {
      previewed.push(binding)
      return <div data-testid="host-preview">{binding.target.kind}</div>
    },
    Input: Empty,
    Textarea: Empty,
    ProblemLine: Empty,
    ProblemState: Empty,
  })
})
afterAll(async () => {
  unbind()
  await teardown()
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
})

async function mount(props: RefProps) {
  const View = viewOf('ref')!.View
  const host = document.createElement('div')
  document.body.append(host)
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <CanvasProvider>
        <View
          id="r1"
          props={props}
          width={320}
          height={132}
          selected={false}
          editing={false}
          missing={false}
          sessionId="s0"
          stamp={0}
          commit={() => undefined}
          resize={() => undefined}
          stopEditing={() => undefined}
        />
      </CanvasProvider>,
    ),
  )
  return { host, dispose: () => act(async () => root.unmount()) }
}

test('a session link shows its name, its kind and the host drawing of it', async () => {
  const props: RefProps = {
    kind: 'session',
    token: '@session:LOCALIX-42',
    label: 'Fix the login flow',
    attributes: { sessionId: 'LOCALIX-42' },
  }
  const view = await mount(props)
  expect(view.host.textContent).toContain('Fix the login flow')
  expect(view.host.textContent).toContain('Session')
  expect(view.host.querySelector('[data-testid="host-preview"]')?.textContent).toBe('session')
  expect(previewed.at(-1)?.target).toEqual({
    kind: 'session',
    token: '@session:LOCALIX-42',
    label: 'Fix the login flow',
    attributes: { sessionId: 'LOCALIX-42' },
  })
  await view.dispose()
})

test('a link the agent wrote as a bare token is completed from the token', async () => {
  const view = await mount({ kind: 'session', token: '@session:LOCALIX-7', label: '' })
  expect(previewed.at(-1)?.target.attributes).toEqual({ sessionId: 'LOCALIX-7' })
  expect(view.host.textContent).toContain('@session:LOCALIX-7')
  await view.dispose()
})

test('a resource is named by the provider that owns it, and shows its URI', async () => {
  const uri = 'localix://resource/database/conn-1/public/users'
  const view = await mount({ kind: 'resource', token: `@resource:${uri}`, label: 'users', uri })
  expect(view.host.textContent).toContain('database')
  expect(view.host.textContent).toContain(uri)
  await view.dispose()
})

test('its grip drags out the very link that was dropped in', async () => {
  const props: RefProps = {
    kind: 'call',
    token: '@call:tc_1',
    label: 'login.ts',
    attributes: { toolCallId: 'tc_1', sessionId: 's1' },
    miniApp: 'database',
  }
  const view = await mount(props)
  const data = new Map<string, string>()
  const transfer = {
    types: [] as string[],
    effectAllowed: 'uninitialized',
    setData: (type: string, value: string) => {
      data.set(type, value)
      transfer.types.push(type)
    },
    getData: (type: string) => data.get(type) ?? '',
    setDragImage: () => undefined,
  }
  const grip = view.host.querySelector<HTMLElement>('[aria-label^="Drag login.ts"]')!
  const event = new window.Event('dragstart', { bubbles: true }) as unknown as DragEvent
  Object.defineProperty(event, 'dataTransfer', { value: transfer })
  await act(async () => grip.dispatchEvent(event))
  expect(data.has(MESSAGE_BINDING_MIME)).toBe(true)
  expect(data.get('text/plain')).toBe('@call:tc_1')
  const back = readMessageBindingDrag(transfer as unknown as DataTransfer)
  expect(back).toMatchObject({
    miniApp: 'database',
    target: {
      kind: 'call',
      token: '@call:tc_1',
      attributes: { toolCallId: 'tc_1', sessionId: 's1' },
    },
  })
  await view.dispose()
})
