import { afterEach, describe, expect, test } from 'bun:test'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ShutdownSignal } from './process-signals'

const children = new Set<ChildProcess>()
afterEach(() => {
  for (const child of children) {
    try {
      child.kill('SIGKILL')
    } catch {}
  }
  children.clear()
})

async function waitUntil(condition: () => boolean, capMs = 5_000): Promise<void> {
  const deadline = Date.now() + capMs
  while (!condition() && Date.now() < deadline) await Bun.sleep(20)
}

describe('standalone API OS signals', () => {
  test.skipIf(process.platform === 'win32')(
    'real SIGINT/SIGTERM/SIGHUP each run graceful shutdown before process exit',
    async () => {
      const moduleUrl = new URL('./process-signals.ts', import.meta.url).href
      for (const signal of [
        'SIGINT',
        'SIGTERM',
        'SIGHUP',
      ] as const satisfies readonly ShutdownSignal[]) {
        const dir = mkdtempSync(join(tmpdir(), 'localix-signal-'))
        const marker = join(dir, 'stopped')
        const source = `
          import { writeFileSync } from 'node:fs'
          import { installServerSignalHandlers } from ${JSON.stringify(moduleUrl)}
          installServerSignalHandlers(async () => writeFileSync(${JSON.stringify(marker)}, 'yes'))
          process.stdout.write('READY\\n')
          setInterval(() => {}, 1000)
        `
        const child = spawn(process.execPath, ['-e', source], {
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        children.add(child)
        let stdout = ''
        let stderr = ''
        child.stdout?.on('data', (chunk) => (stdout += String(chunk)))
        child.stderr?.on('data', (chunk) => (stderr += String(chunk)))
        await waitUntil(() => stdout.includes('READY') || child.exitCode !== null)
        expect(stdout).toContain('READY')
        expect(child.pid).toBeDefined()

        const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) =>
          child.once('exit', (code, exitSignal) => resolve({ code, signal: exitSignal })),
        )
        process.kill(child.pid!, signal)
        const exit = await exited
        children.delete(child)
        expect(exit).toEqual({ code: 0, signal: null })
        expect(existsSync(marker)).toBe(true)
        expect(readFileSync(marker, 'utf8')).toBe('yes')
        expect(stderr).toBe('')
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
})
