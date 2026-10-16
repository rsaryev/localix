import { describe, expect, test } from 'bun:test'
import { bunPtyBackend } from './pty-bun'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function processGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitUntil(condition: () => boolean, capMs = 4_000): Promise<void> {
  const deadline = Date.now() + capMs
  while (!condition() && Date.now() < deadline) await sleep(20)
}

describe('Bun PTY process ownership', () => {
  test.skipIf(process.platform === 'win32')(
    'kill reaps the whole process group even when the shell ignores HUP and TERM',
    async () => {
      let output = ''
      let pid = 0
      const pty = bunPtyBackend.spawn({
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
        command: 'trap "" HUP TERM; echo "PID=$$"; while :; do sleep 1; done',
      })
      pty.onData((data) => {
        output += data
        const match = output.match(/PID=(\d+)/)
        if (match) pid = Number(match[1])
      })

      try {
        await waitUntil(() => pid > 0)
        expect(pid).toBeGreaterThan(0)
        expect(processGroupAlive(pid)).toBe(true)
        pty.kill()
        await waitUntil(() => !processGroupAlive(pid))
        expect(processGroupAlive(pid)).toBe(false)
      } finally {
        // A failed assertion must never leave the deliberately signal-resistant
        // fixture behind on the developer/CI machine.
        if (pid > 0 && processGroupAlive(pid)) {
          try {
            process.kill(-pid, 'SIGKILL')
          } catch {}
        }
      }
    },
  )
})
