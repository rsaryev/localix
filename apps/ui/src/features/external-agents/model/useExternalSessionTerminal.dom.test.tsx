import { afterAll, beforeAll, expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { act } from 'react'
import { useChatStore } from '@/features/chat/model/store'
import type { UiSession } from '@/shared/api/contracts'
import { terminal as terminalBus } from '@/shared/lib/terminalBus'
import { externalAgentsApi } from '../api'
import { useExternalSessionTerminal } from './useExternalSessionTerminal'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})
function Surface({ id }: { id: string | null }) {
  useExternalSessionTerminal(id)
  return <p>Our chat</p>
}

test('opening a persisted external chat through any navigation opens its own terminal', async () => {
  const original = useChatStore.getState()
  useChatStore.setState({
    allSessions: [
      { id: 'external', externalAgentProvider: 'codex' },
      { id: 'local' },
    ] as UiSession[],
    sessions: [],
  })
  const open = spyOn(externalAgentsApi, 'openOwned').mockResolvedValue({
    terminalId: 'pty',
    providerName: 'Codex',
  })
  const reveal = mock((_sessionId: string, _terminalId: string, _title: string) => {})
  const unregister = terminalBus.setOwnedOpener(reveal)
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Surface id="local" />))
    expect(open).not.toHaveBeenCalled()
    await act(async () => root.render(<Surface id="external" />))
    expect(host.textContent).toBe('Our chat')
    expect(open).toHaveBeenCalledWith('external')
    expect(reveal).toHaveBeenCalledWith('external', 'pty', 'Codex')
    await act(async () => root.render(<Surface id="external" />))
    expect(open).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    useChatStore.setState(original)
    open.mockRestore()
    unregister()
  }
})
