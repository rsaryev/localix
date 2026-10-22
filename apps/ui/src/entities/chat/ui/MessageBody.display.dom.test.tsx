import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { Message } from '../model/types'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

test("a MessageDisplay hook's text is shown in place of the stored one, block by block", async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { MessageBody } = await import('./MessageBody')
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const message: Message = {
    id: 'reply',
    role: 'assistant',
    content: 'Stored first.Stored second.',
    items: [
      { id: 't1', type: 'text', status: 'completed', text: 'Stored first.' },
      { id: 't2', type: 'text', status: 'completed', text: 'Stored second.' },
    ],
    displayTexts: { t1: 'Shown by the hook.' },
  }
  try {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <MessageBody message={message} isUser={false} />
        </MemoryRouter>,
      )
    })
    expect(host.textContent).toContain('Shown by the hook.')
    expect(host.textContent).not.toContain('Stored first.')
    // A block the hook left alone shows its own text.
    expect(host.textContent).toContain('Stored second.')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
