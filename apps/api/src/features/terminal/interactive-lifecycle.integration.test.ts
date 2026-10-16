import { describe, expect, test } from 'bun:test'
import { runTerminalAction, type TerminalToolDeps } from '../agent-core/tools/terminal/terminal'
import { bunPtyBackend } from './pty-bun'
import { createTerminalService } from './service'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function waitUntil(condition: () => boolean, capMs = 8_000): Promise<void> {
  const deadline = Date.now() + capMs
  while (!condition() && Date.now() < deadline) await sleep(20)
}

/**
 * Real production-path proof for the Codex-style lifecycle:
 * Bun PTY -> server TerminalService -> bash interactive action hooks. The input
 * value is deliberately secret-like so the assertions also pin the privacy
 * boundary: only a generic interaction marker may leave the terminal service.
 */
describe('interactive terminal lifecycle (real PTY)', () => {
  test.skipIf(process.platform === 'win32')(
    'waits for a prompt, accepts user input, settles, and never publishes input bytes',
    async () => {
      const lifecycle: unknown[] = []
      const service = createTerminalService({
        backend: bunPtyBackend,
        resolveCwd: async () => process.cwd(),
        publishLifecycle: (_userId, _sessionId, event) => lifecycle.push(event),
      })
      const command =
        'printf "PROMPT>"; IFS= read -r answer; printf "\\nDONE length=%s\\n" "${#answer}"'
      const terminal = await service.spawnCommand('owner', {
        sessionId: 'chat-1',
        command,
      })
      const waits = new Map<string, { label?: string }>()
      const deps: TerminalToolDeps = {
        open: async () => ({
          terminalId: terminal.id,
          screen: await terminal.screen(),
        }),
        screen: async (terminalId) => (await service.get('owner', terminalId)?.screen()) ?? null,
        finalScreen: (terminalId) => service.finalScreen('owner', terminalId),
        watch: (terminalId, onEvent) => {
          const owned = service.get('owner', terminalId)
          if (!owned) return null
          const offData = owned.subscribe(() => onEvent('output'))
          const offExit = owned.onExit(() => onEvent('exit'))
          return () => {
            offData()
            offExit()
          }
        },
        write: (terminalId, data) => {
          const owned = service.get('owner', terminalId)
          if (!owned) return false
          owned.write(data)
          return true
        },
        list: () => service.list('owner').map((item) => ({ terminalId: item.id })),
        close: (terminalId) => service.close('owner', terminalId),
        onWait: (event) => {
          lifecycle.push({ type: 'terminal.waiting', ...event })
          if (event.active) waits.set(event.terminalId, { label: event.label })
          else waits.delete(event.terminalId)
        },
        onInput: (event) => lifecycle.push({ type: 'terminal.input', ...event }),
      }

      await waitUntil(() => terminal.replay.includes('PROMPT>'))
      expect(terminal.replay).toContain('PROMPT>')

      const waiting = runTerminalAction(
        deps,
        {
          action: 'wait',
          terminal_id: terminal.id,
          wait_for: 'DONE',
          wait_timeout_ms: 5_000,
        },
        undefined,
      )
      await waitUntil(() => waits.has(terminal.id))
      expect(waits.has(terminal.id)).toBe(true)

      const secret = 'correct-horse-battery-staple'
      expect(service.writeUserInput('owner', terminal.id, `${secret}\r`)).toBe(true)
      const result = await waiting
      expect(result.content).toContain('"DONE" appeared')
      expect(result.content).toContain(`length=${secret.length}`)
      expect(waits.has(terminal.id)).toBe(false)

      await waitUntil(() => lifecycle.some((event) => JSON.stringify(event).includes('finished')))
      const serialized = JSON.stringify(lifecycle)
      expect(serialized).not.toContain(secret)
      expect(lifecycle).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'terminal.waiting',
            terminalId: terminal.id,
            active: true,
          }),
          expect.objectContaining({
            type: 'terminal.input',
            terminalId: terminal.id,
            source: 'user',
            label: 'user input',
          }),
          expect.objectContaining({
            type: 'terminal.waiting',
            terminalId: terminal.id,
            active: false,
          }),
          expect.objectContaining({
            type: 'terminal.finished',
            terminalId: terminal.id,
            exitCode: 0,
          }),
        ]),
      )
    },
  )
})
