import { expect, test } from 'bun:test'
import { createBashTool } from '../agent-core/tools/bash/bash'
import type { TerminalToolDeps } from '../agent-core/tools/terminal/terminal'
import { bunPtyBackend } from './pty-bun'
import { createTerminalService } from './service'

// The read has its own deadline; the tool has an abort deadline; teardown always kills the PTY.
test.skipIf(process.platform === 'win32')(
  'one bash call submits to a real PTY and returns its answer',
  async () => {
    const service = createTerminalService({
      backend: bunPtyBackend,
      resolveCwd: async () => process.cwd(),
    })
    try {
      const terminal = await service.spawnCommand('owner', {
        sessionId: 'chat-1',
        command:
          'printf "READY>"; IFS= read -r -t 3 answer; printf "\\nDONE length=%s\\n" "${#answer}"',
      })
      const deps: TerminalToolDeps = {
        open: async () => ({ terminalId: terminal.id, screen: await terminal.screen() }),
        screen: async (id) => (await service.get('owner', id)?.screen()) ?? null,
        finalScreen: (id) => service.finalScreen('owner', id),
        watch: (id, listener) => {
          const live = service.get('owner', id)
          if (!live) return null
          const offData = live.subscribe(() => listener('output'))
          const offExit = live.onExit(() => listener('exit'))
          return () => {
            offData()
            offExit()
          }
        },
        write: (id, data) => {
          const live = service.get('owner', id)
          if (!live) return false
          live.write(data)
          return true
        },
        list: () => service.list('owner').map(({ id }) => ({ terminalId: id })),
        close: (id) => service.close('owner', id),
      }
      const tool = createBashTool(undefined, undefined, { terminalControl: deps })
      const signal = AbortSignal.timeout(5_000)
      const ready = await tool.execute(
        'ready',
        {
          action: 'wait',
          terminal_id: terminal.id,
          wait_for: 'READY>',
          wait_timeout_ms: 1_000,
        },
        signal,
        undefined,
        undefined,
      )
      expect(ready.content).toContain('READY>')
      const result = await tool.execute(
        'input',
        {
          action: 'type',
          terminal_id: terminal.id,
          text: 'hello',
          keys: ['Enter'],
          wait_for: 'DONE length=5',
          wait_timeout_ms: 2_000,
        },
        signal,
        undefined,
        undefined,
      )
      expect(result.isError).toBeFalsy()
      expect(result.content).toContain('DONE length=5')
      expect(result.details).toMatchObject({ action: 'type', waitOutcome: 'matched' })
    } finally {
      service.disposeAll()
    }
  },
  8_000,
)
