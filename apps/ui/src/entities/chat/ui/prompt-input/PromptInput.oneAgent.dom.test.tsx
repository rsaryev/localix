import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { act, useState } from 'react'
import { MemoryRouter } from 'react-router'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

/**
 * A conversation has exactly one agent, fixed at creation. The composer therefore has nobody to
 * add and nobody to address: an `@` offers
 * workspace things (files, resources) but never an agent.
 */
describe('composer of a one-agent conversation', () => {
  test('offers no agent rows after "@"', async () => {
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
          agent: {
            agentId: 'builtin:localix',
            handle: 'localix',
            providerConnectionId: 'c1',
            modelId: 'm1',
            reasoningEffort: 'medium',
          },
        } as never,
      ],
    })

    function Harness() {
      const [prompt, setPrompt] = useState('')
      return (
        <MemoryRouter>
          <button
            type="button"
            aria-label="Type at"
            data-testid="type-at"
            onClick={() => setPrompt('@')}
          />
          <PromptInput
            prompt={prompt}
            setPrompt={setPrompt}
            isGenerating={false}
            isFocused
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
      )
    }

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Harness />))
      await act(async () =>
        host.querySelector<HTMLButtonElement>('[data-testid="type-at"]')!.click(),
      )

      expect(host.querySelector('[data-kind="agent"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
