import { afterEach, describe, expect, test } from 'bun:test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DESKTOP_RUNTIME_ARG,
  LOCALIX_RUNTIME_READY_PREFIX,
  RUNTIME_ENV,
  RUNTIME_SHUTDOWN_COMMAND,
  RUNTIME_SHUTDOWN_DEADLINE_MS,
} from './lib/runtime-protocol'

/**
 * A deliberate stop of a desktop runtime that has a page connected and a terminal open must
 * finish inside its own deadline and exit 0. Exit 1 used to come out of exactly this case (the
 * listener's close timed out, a terminal's dispose threw), and the desktop shell reads a
 * non-zero exit as a crash and starts the runtime again.
 */
const ORIGIN = 'tauri://localhost'
const children = new Set<ChildProcess>()
const homes: string[] = []

afterEach(() => {
  for (const child of children) child.kill('SIGKILL')
  children.clear()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

async function waitFor(condition: () => boolean, capMs: number): Promise<void> {
  const deadline = Date.now() + capMs
  while (!condition() && Date.now() < deadline) await Bun.sleep(20)
}

describe('desktop runtime shutdown', () => {
  test.skipIf(process.platform === 'win32')(
    'stops within its deadline and exits 0 with a websocket and a terminal open',
    async () => {
      const home = mkdtempSync(join(tmpdir(), 'localix-shutdown-'))
      homes.push(home)
      const child = spawn(
        process.execPath,
        [join(import.meta.dir, 'index.ts'), DESKTOP_RUNTIME_ARG],
        {
          env: {
            ...process.env,
            HOME: home,
            USERPROFILE: home,
            PORT: '0',
            HOST: '127.0.0.1',
            NODE_ENV: 'production',
            LOCALIX_DB_FILE: join(home, '.localix', 'localix.db'),
            [RUNTIME_ENV.parentPid]: String(process.pid),
          },
          stdio: ['pipe', 'pipe', 'pipe'],
          killSignal: 'SIGKILL',
        },
      )
      children.add(child)
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (chunk) => (stdout += String(chunk)))
      child.stderr?.on('data', (chunk) => (stderr += String(chunk)))
      const exited = new Promise<number | null>((resolve) => child.once('exit', resolve))

      await waitFor(() => stdout.includes(LOCALIX_RUNTIME_READY_PREFIX), 20_000)
      const frame = stdout.split('\n').find((line) => line.startsWith(LOCALIX_RUNTIME_READY_PREFIX))
      expect(frame, stderr).toBeDefined()
      const { baseUrl } = JSON.parse(frame!.slice(LOCALIX_RUNTIME_READY_PREFIX.length)) as {
        baseUrl: string
      }

      const post = async (path: string, body: unknown) => {
        const response = await fetch(`${baseUrl}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: ORIGIN },
          body: JSON.stringify(body),
        })
        expect(response.status, `${path}: ${await response.clone().text()}`).toBeLessThan(300)
        return (await response.json()) as Record<string, unknown>
      }
      const session = await post('/rpc/sessions', {})
      const sessionId = String((session.session as { id?: string } | undefined)?.id ?? session.id)
      const terminal = await post('/rpc/terminal', { sessionId, cwd: home })
      expect(terminal.id).toBeTruthy()

      const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/rpc/ws`, {
        headers: { origin: ORIGIN },
      } as unknown as string[])
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve()
        socket.onerror = () => reject(new Error('realtime socket did not open'))
      })
      const streamed = new WebSocket(
        `${baseUrl.replace('http', 'ws')}/rpc/terminal/${String(terminal.id)}/stream`,
        {
          headers: { origin: ORIGIN },
        } as unknown as string[],
      )
      await new Promise<void>((resolve, reject) => {
        streamed.onopen = () => resolve()
        streamed.onerror = () => reject(new Error('terminal stream did not open'))
      })

      const started = Date.now()
      child.stdin?.write(`${RUNTIME_SHUTDOWN_COMMAND}\n`)
      const code = await exited
      children.delete(child)
      const elapsed = Date.now() - started

      expect(code, stderr).toBe(0)
      expect(elapsed).toBeLessThan(RUNTIME_SHUTDOWN_DEADLINE_MS)
      // The old order waited out a whole 1.5 s step on the listener's close with this setup.
      expect(elapsed).toBeLessThan(1_500)
      expect(stderr).not.toContain('passed its')
      expect(stderr).not.toContain('did not finish cleanly')
    },
    40_000,
  )
})
