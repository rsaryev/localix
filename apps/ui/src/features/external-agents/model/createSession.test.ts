import { expect, mock, spyOn, test } from 'bun:test'
import { terminal as terminalBus } from '@/shared/lib/terminalBus'
import { externalAgentsApi } from '../api'
import { openOwnedExternalSession } from './createSession'

test('opening our external session reveals the terminal belonging to that chat', async () => {
  const open = spyOn(externalAgentsApi, 'openOwned').mockResolvedValue({
    terminalId: 'pty',
    providerName: 'Codex',
  })
  const reveal = mock((_sessionId: string, _terminalId: string, _title: string) => {})
  const unregister = terminalBus.setOwnedOpener(reveal)
  try {
    await openOwnedExternalSession('owner')
    expect(open).toHaveBeenCalledWith('owner')
    expect(reveal).toHaveBeenCalledWith('owner', 'pty', 'Codex')
  } finally {
    open.mockRestore()
    unregister()
  }
})
