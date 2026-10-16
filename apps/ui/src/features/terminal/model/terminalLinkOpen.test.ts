import { describe, expect, spyOn, test } from 'bun:test'
import { inspector } from '@/shared/lib/inspectorBus'
import { openTerminalLink } from './terminalLinkOpen'

// A file link used to open in the chat on screen, so a path printed by a background chat's build
// landed in another chat's workspace. It opens in the terminal's own chat.
describe('terminal file links', () => {
  test("open in the terminal's chat, with the line the output carried", () => {
    const open = spyOn(inspector, 'openFile').mockImplementation(() => {})
    try {
      openTerminalLink('terminal-owner', {
        kind: 'file',
        label: 'src/a.ts:12',
        path: 'src/a.ts',
        line: 12,
      })
      openTerminalLink('terminal-owner', { kind: 'file', label: 'src/b.ts', path: 'src/b.ts' })
      expect(open.mock.calls).toEqual([
        [{ sessionId: 'terminal-owner', path: 'src/a.ts', line: 12 }],
        [{ sessionId: 'terminal-owner', path: 'src/b.ts' }],
      ])
    } finally {
      open.mockRestore()
    }
  })
})
