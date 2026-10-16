import { expect, spyOn, test } from 'bun:test'
import * as terminals from '@/features/terminal/model/terminalTabs'
import { externalAgentsApi } from '../api'
import { openOwnedExternalSession } from './createSession'

test('opening our external session reveals the terminal belonging to that chat', async () => {
  const open = spyOn(externalAgentsApi, 'openOwned').mockResolvedValue({
    terminalId: 'pty',
    providerName: 'Codex',
  })
  const reveal = spyOn(terminals, 'openOwnedTerminal').mockImplementation(() => {})
  try {
    await openOwnedExternalSession('owner')
    expect(open).toHaveBeenCalledWith('owner')
    expect(reveal).toHaveBeenCalledWith('owner', 'pty', 'Codex')
  } finally {
    open.mockRestore()
    reveal.mockRestore()
  }
})
