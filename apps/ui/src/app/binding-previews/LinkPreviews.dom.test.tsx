import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import type { MessageContextBindingDraft } from '@localixai/plugin-sdk/ui'
import { createMessageBindingDraft } from '@localixai/plugin-sdk/ui/message-binding-drag'
import type { UiSession } from '@/shared/api/contracts'
import { registerDom } from '@localixai/kit/testing/dom'

/**
 * A link dropped outside the chat (a plugin's board) is drawn by the host from the conversation it
 * points into — whether or not that conversation is open — and says plainly when the target is
 * not on this machine instead of drawing an empty card.
 */
let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

const session = {
  id: 's1',
  seq: 42,
  title: 'Fix the login flow',
  bodyLoaded: true,
  projectId: 'p1',
  runtimeStatus: 'completed',
  isRunning: false,
  agents: [{ handle: 'dev', modelId: 'claude-opus-5-5' }],
  updatedAt: Date.now() - 3 * 60_000,
  messages: [
    { id: 'm1', role: 'user', content: 'Why does login loop?', items: [] },
    {
      id: 'm2',
      role: 'assistant',
      content: 'The token **expires** before the redirect.',
      items: [
        {
          id: 'i1',
          type: 'tool_call',
          status: 'completed',
          toolCallId: 'call-read-1',
          name: 'read',
          activeVerb: 'Reading',
          input: { path: '/repo/src/login.ts' },
        },
      ],
    },
  ],
} as unknown as UiSession

async function mount(binding: MessageContextBindingDraft) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { useChatStore } = await import('@/features/chat/model/store')
  const { backendClient } = await import('@/shared/api/client')
  const { PluginContextBindingPreview } = await import('../pluginBindingComponents')
  useChatStore.setState({ sessions: [session], allSessions: [session] })
  // A session the store does not hold is read from the server: here, one that is gone.
  const original = spyOn(backendClient, 'getSession').mockRejectedValue(new Error('not found'))
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <MemoryRouter>
        <PluginContextBindingPreview binding={binding} sessionId={null} />
      </MemoryRouter>,
    ),
  )
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
  return {
    text: () => host.textContent ?? '',
    host,
    dispose: async () => {
      await act(async () => root.unmount())
      host.remove()
      original.mockRestore()
      useChatStore.setState({ sessions: [], allSessions: [] })
    },
  }
}

describe('a link to the conversation, drawn outside the chat', () => {
  test('a session shows its title, state, model and last word — also by its LOCALIX ref', async () => {
    for (const id of ['s1', 'LOCALIX-42']) {
      const view = await mount(createMessageBindingDraft('session', id, 'old title'))
      try {
        expect(view.text()).toContain('Fix the login flow')
        expect(view.text()).toContain('LOCALIX-42')
        expect(view.text()).toContain('Done')
        expect(view.text()).toContain('claude-opus-5-5')
        // The last word is rendered, not shown as its markdown source.
        expect(view.host.querySelector('strong')?.textContent).toBe('expires')
        expect(view.text()).not.toContain('**')
      } finally {
        await view.dispose()
      }
    }
  })

  test('a message is the message, rendered as the chat renders it', async () => {
    const view = await mount(createMessageBindingDraft('message', 's1/m2', 'The token'))
    try {
      expect(view.host.querySelector('strong')?.textContent).toBe('expires')
      expect(view.text()).toContain('Fix the login flow')
    } finally {
      await view.dispose()
    }
  })

  test("a tool call is the transcript's own card for it", async () => {
    const link = createMessageBindingDraft('call', 'call-read-1', 'login.ts')
    const view = await mount({
      ...link,
      target: { ...link.target, attributes: { ...link.target.attributes, sessionId: 's1' } },
    })
    try {
      expect(view.host.querySelector('[data-slot="tool-line-title"]')?.textContent).toBe('login.ts')
    } finally {
      await view.dispose()
    }
  })

  test('a call without its session is found in the conversations that are open', async () => {
    const view = await mount(createMessageBindingDraft('call', 'call-read-1', 'login.ts'))
    try {
      expect(view.host.querySelector('[data-slot="tool-line-title"]')?.textContent).toBe('login.ts')
    } finally {
      await view.dispose()
    }
  })

  test('a link whose target is not on this machine says so', async () => {
    const view = await mount(createMessageBindingDraft('session', 'elsewhere', 'Their session'))
    try {
      expect(view.text()).toBe('This session is not on this machine.')
    } finally {
      await view.dispose()
    }
  })
})
