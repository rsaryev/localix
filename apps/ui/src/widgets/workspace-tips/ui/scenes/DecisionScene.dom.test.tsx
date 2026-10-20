import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

test('the OpenRouter slide offers sign-in until a connection to OpenRouter exists', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useChatStore } = await import('@/features/chat/model/store')
  const { DecisionAction } = await import('./DecisionScene')
  // No server behind the test: the connections are what the store holds.
  useChatStore.setState({ refreshConnections: async () => {}, connections: [] })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const trigger = () => host.querySelector('button')?.getAttribute('aria-label')

  await act(async () => root.render(<DecisionAction />))
  expect(trigger()).toBe('OpenRouter: Sign in. Change')

  await act(async () =>
    useChatStore.setState({
      connections: [{ id: 'c1', providerId: 'openrouter', label: 'OpenRouter' } as never],
    }),
  )
  expect(trigger()).toBe('OpenRouter: Connected. Change')

  await act(async () => root.unmount())
  host.remove()
})
