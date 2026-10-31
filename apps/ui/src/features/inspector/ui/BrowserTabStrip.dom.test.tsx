import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { useAgentPresence } from '../model/agentPresence'
import { BrowserTabStrip } from './BrowserTabStrip'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

const tabs = [
  { previewId: 'native-1', url: 'https://example.com/', title: 'Example', version: 1 },
  { previewId: 'native-2', url: 'https://openai.com/', title: 'OpenAI', version: 1 },
]
const ids = { item: () => ({}) } as never

test('the tab the agent is working in says so, and only that one', async () => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <BrowserTabStrip
          sessionId="s"
          tabs={tabs}
          activeId="native-1"
          newTabOpen={false}
          tabIds={ids}
          onSelect={() => {}}
          onNewTab={() => {}}
          onOpenHistory={() => {}}
        />,
      ),
    )
    expect(container.querySelector('[aria-label="The agent is working in this tab"]')).toBeNull()
    await act(async () => useAgentPresence.getState().begin('native-2'))
    const marks = container.querySelectorAll('[aria-label="The agent is working in this tab"]')
    expect(marks.length).toBe(1)
    const tab = marks[0]!.closest('[role="tab"]')
    expect(tab?.textContent).toContain('OpenAI')
    await act(async () => useAgentPresence.getState().forget('native-2'))
    expect(container.querySelector('[aria-label="The agent is working in this tab"]')).toBeNull()
  } finally {
    await act(async () => root.unmount())
  }
})
