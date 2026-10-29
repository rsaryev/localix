import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { act, useState } from 'react'
import { MemoryRouter } from 'react-router'
import { SWRConfig } from 'swr'
import { registerDom } from '@localixai/kit/testing/dom'
import { makeListing } from '@localixai/store/testing'
import { turns } from '@/testing/settle'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})
afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__
})

/** The Store recommends one package; nothing else is on offer. */
async function recommendDocker() {
  const { storeApi } = await import('@/shared/api/store-client')
  const { localModelsApi } = await import('@/shared/api/localModelsApi')
  const docker = makeListing({ id: 'docker', kind: 'plugin', displayName: 'Docker tools' })
  // No app update: it would take the strip's place.
  ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: async () => ({ available: false, currentVersion: '0.1.0', latestVersion: null }),
    },
  }
  await (await import('@/shared/hooks/useDesktopUpdate')).checkDesktopUpdate()
  return [
    spyOn(storeApi, 'activity').mockResolvedValue({ jobs: [], updates: [] }),
    spyOn(storeApi, 'reportWorkingSet').mockResolvedValue(undefined),
    spyOn(storeApi, 'recommendations').mockResolvedValue({
      listings: [docker],
      matched: 1,
      strategy: { mode: 'hybrid' },
      pending: false,
    }),
    spyOn(localModelsApi, 'status').mockResolvedValue({
      jobs: [],
      paused: [],
      installed: [],
      running: [],
    } as never),
  ]
}

async function mountComposer(pane: { isFocused: boolean; isVisible: boolean }) {
  const { createRoot } = await import('react-dom/client')
  const { PromptInput } = await import('./PromptInput')
  const { useChatStore } = await import('../../model/store')
  useChatStore.setState({
    allSessions: [
      {
        id: 's1',
        seq: 1,
        title: 'Chat',
        messages: [],
        queuedMessages: [],
        pinnedSkills: [],
        todos: [],
        loops: [],
        queue: [],
        modelView: null,
      } as never,
    ],
  })
  function Harness() {
    const [prompt, setPrompt] = useState('')
    return (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter>
          <PromptInput
            prompt={prompt}
            setPrompt={setPrompt}
            isGenerating={false}
            isFocused={pane.isFocused}
            isVisible={pane.isVisible}
            activeSessionId="s1"
            activeConnectionId="c1"
            hasConnection
            model="m1"
            setModel={() => {}}
            models={[]}
            reasoningEffort="medium"
            setReasoningEffort={() => {}}
            resolvedTheme="dark"
            onSend={() => {}}
            onStop={() => {}}
            connectionsState={{ connections: [] } as never}
          />
        </MemoryRouter>
      </SWRConfig>
    )
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<Harness />))
  await act(async () => turns())
  return {
    host,
    done: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('the strips above the composer', () => {
  test('stay while the chat is on screen, whether or not its pane has focus', async () => {
    const spies = await recommendDocker()
    const view = await mountComposer({ isFocused: false, isVisible: true })
    try {
      expect(view.host.textContent).toContain('Recommended for you')
    } finally {
      await view.done()
      spies.forEach((spy) => spy.mockRestore())
    }
  })

  test('a chat kept warm behind another tab shows none', async () => {
    const spies = await recommendDocker()
    const view = await mountComposer({ isFocused: false, isVisible: false })
    try {
      expect(view.host.textContent).not.toContain('Recommended for you')
    } finally {
      await view.done()
      spies.forEach((spy) => spy.mockRestore())
    }
  })
})
