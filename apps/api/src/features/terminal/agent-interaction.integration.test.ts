import { expect, test } from 'bun:test'
import { createBashTool } from '../agent-core/tools/bash/bash'
import type { TerminalToolDeps } from '../agent-core/tools/terminal/terminal'
import { bunPtyBackend } from './pty-bun'
import { createTerminalService } from './service'
import type { TerminalService } from './service'

function control(service: TerminalService): TerminalToolDeps {
  return {
    open: async ({ command }) => {
      const terminal = await service.spawnCommand('owner', { sessionId: 'chat-1', command })
      return { terminalId: terminal.id, screen: await terminal.screen() }
    },
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
}

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
      const deps = control(service)
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

test.skipIf(process.platform === 'win32')(
  'large Unicode PTY output stays bounded for the model and accepts input through exit',
  async () => {
    const service = createTerminalService({
      backend: bunPtyBackend,
      resolveCwd: async () => process.cwd(),
    })
    try {
      const deps = control(service)
      const tool = createBashTool(undefined, undefined, { terminalControl: deps })
      const signal = AbortSignal.timeout(10_000)
      const terminal = await service.spawnCommand('owner', {
        sessionId: 'chat-1',
        cols: 83,
        rows: 52,
        command:
          `printf 'READY>'; IFS= read -r -t 5 start; ` +
          `awk 'BEGIN { for (i=0; i<5000; i++) { printf "ROW_%05d ", i; ` +
          `for (j=0; j<30; j++) printf "abcde🙂"; printf "\\n" } }'; ` +
          `printf 'BULK_DONE rows=5000\\nafter>'; IFS= read -r -t 5 answer; ` +
          `printf '\\nAFTER_ECHO=%s\\n' "$answer"`,
      })
      const ready = await tool.execute(
        'ready',
        { action: 'wait', terminal_id: terminal.id, wait_for: 'READY>', wait_timeout_ms: 1_000 },
        signal,
      )
      expect(ready.details).toMatchObject({ waitOutcome: 'matched' })
      const bulk = await tool.execute(
        'bulk',
        {
          action: 'keys',
          terminal_id: terminal.id,
          keys: ['Enter'],
          wait_for: 'BULK_DONE rows=5000',
          wait_timeout_ms: 5_000,
        },
        signal,
      )
      expect(bulk.details).toMatchObject({ waitOutcome: 'matched' })
      expect(bulk.content).toContain('BULK_DONE rows=5000')
      expect(bulk.content).toContain('viewport clipped')
      expect(bulk.content.length).toBeLessThan(2_500)
      expect(Buffer.from(bulk.content).toString()).toBe(bulk.content)
      const finished = await tool.execute(
        'finish',
        {
          action: 'type',
          terminal_id: terminal.id,
          text: 'alive after large output',
          keys: ['Enter'],
          wait_for_exit: true,
          wait_timeout_ms: 2_000,
        },
        signal,
      )
      expect(finished.isError).toBeFalsy()
      expect(finished.content).toContain('AFTER_ECHO=alive after large output')
      expect(finished.details).toMatchObject({ state: 'exited', waitOutcome: 'exited' })
      expect(service.list('owner')).toEqual([])
    } finally {
      service.disposeAll()
    }
  },
  12_000,
)
