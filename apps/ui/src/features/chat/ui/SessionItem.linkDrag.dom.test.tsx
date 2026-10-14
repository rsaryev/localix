import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import {
  readMessageBindingDrag,
  clearMessageBindingDragAvailability,
} from '@localixai/plugin-sdk/ui/message-binding-drag'
import { WorkspaceTabTransferTargets } from '@/widgets/editor-grid/ui/WorkspaceTabTransferTargets'
import type { UiSession } from '@/shared/api/ui-session'
import { SessionItem } from './SessionItem'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

async function mount() {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let linked: ReturnType<typeof readMessageBindingDrag> = null
  const session = {
    id: 'sidebar-drag-session',
    seq: 12,
    title: 'A conversation',
    projectId: 'project',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as unknown as UiSession
  await act(async () =>
    root.render(
      <>
        <SessionItem
          session={session}
          isActive={false}
          onSelect={() => {}}
          onDelete={() => {}}
          onTogglePin={() => {}}
        />
        <div
          data-composer
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            linked = readMessageBindingDrag(event.dataTransfer)
          }}
        />
        <WorkspaceTabTransferTargets />
      </>,
    ),
  )
  const row = host.querySelector('[draggable="true"]')!
  const data = new Map<string, string>([
    ['text/plain', 'old text'],
    ['text/uri-list', 'https://example.com/'],
  ])
  const transfer = {
    effectAllowed: 'none',
    dropEffect: 'none',
    get types() {
      return [...data.keys()]
    },
    clearData() {
      data.clear()
    },
    getData(key: string) {
      return data.get(key) ?? ''
    },
    setData(key: string, value: string) {
      data.set(key, value)
    },
    setDragImage() {},
  }
  const dispatch = async (type: string, target: Element = row) => {
    const event = new DragEvent(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: transfer })
    await act(async () => target.dispatchEvent(event))
  }
  return {
    host,
    row,
    transfer,
    dispatch,
    linked: () => linked,
    cleanup: async () => {
      await act(async () => root.unmount())
      clearMessageBindingDragAvailability()
      host.remove()
    },
  }
}

test('a sidebar drag exposes only a conversation link and no workspace destinations', async () => {
  const view = await mount()
  try {
    await view.dispatch('dragstart')
    expect(view.transfer.effectAllowed).toBe('copy')
    expect(view.transfer.types).not.toContain('text/plain')
    expect(view.transfer.types).not.toContain('text/uri-list')
    expect(view.transfer.types).not.toContain('application/x-localix-tab')
    expect(view.host.querySelector('[data-workspace-transfer-targets]')).toBeNull()
    expect(document.documentElement.getAttribute('data-localix-agent-link-drag')).toBe('session')
    await act(async () => window.dispatchEvent(new Event('blur')))
    await view.dispatch('dragend')
    expect(document.documentElement.hasAttribute('data-localix-agent-link-drag')).toBe(false)
  } finally {
    await view.cleanup()
  }
})

test('a composer drop links the conversation named by the sidebar row', async () => {
  const view = await mount()
  try {
    await view.dispatch('dragstart')
    await view.dispatch('drop', view.host.querySelector('[data-composer]')!)
    await view.dispatch('dragend')
    expect(view.linked()?.target).toMatchObject({
      kind: 'session',
      token: '@session:sidebar-drag-session',
      attributes: { sessionId: 'sidebar-drag-session' },
    })
    expect(view.host.querySelector('[data-workspace-transfer-targets]')).toBeNull()
  } finally {
    await view.cleanup()
  }
})

test('releasing a sidebar conversation outside creates no workspace destination', async () => {
  const view = await mount()
  try {
    await view.dispatch('dragstart')
    view.transfer.dropEffect = 'copy'
    await view.dispatch('dragend')
    expect(view.linked()).toBeNull()
    expect(view.host.querySelector('[data-workspace-transfer-targets]')).toBeNull()
    expect(view.row.getAttribute('title')).toBe('Drag into the composer to link this conversation')
  } finally {
    await view.cleanup()
  }
})
