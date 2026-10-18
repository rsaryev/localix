import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { explainStartFailure, startLlamaServer } from './llama-server'

const FAKE = path.join(import.meta.dir, 'testing', 'fake-llama-server.ts')
const start = (extra: string[] = [], onExit?: (info: { code: number | null }) => void) =>
  startLlamaServer({
    executable: process.execPath,
    startTimeoutMs: 10_000,
    onExit,
    args: (port, apiKey) => [FAKE, '--port', String(port), '--api-key', apiKey, ...extra],
  })

const embed = (server: Awaited<ReturnType<typeof start>>, input: string[]) =>
  server.request('/v1/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
  })

describe('llama-server process', () => {
  test('starts on loopback, answers with its private key, and stops', async () => {
    const server = await start()
    try {
      expect(server.baseUrl).toStartWith('http://127.0.0.1:')
      const res = await embed(server, ['a', 'bbb'])
      expect(((await res.json()) as { data: unknown[] }).data).toHaveLength(2)
      const anonymous = await fetch(`${server.baseUrl}/v1/embeddings`, {
        method: 'POST',
        body: '{}',
      })
      expect(anonymous.status).toBe(401)
    } finally {
      await server.stop()
    }
    expect(server.running).toBe(false)
  }, 20_000)

  test('a process that dies during start is a start failure, not a hang', async () => {
    await expect(start(['--crash-on-start'])).rejects.toThrow('exited during start')
  }, 20_000)

  test('a crash after start is reported once through onExit', async () => {
    const exits: Array<number | null> = []
    const server = await start([], (info) => exits.push(info.code))
    await embed(server, ['CRASH']).catch(() => null)
    await Bun.sleep(200)
    expect(exits).toEqual([9])
    expect(server.running).toBe(false)
  }, 20_000)

  test('a missing system library is named with the package that provides it', () => {
    const stderr =
      './llama-server: error while loading shared libraries: libgomp.so.1: cannot open shared object file: No such file or directory'
    expect(explainStartFailure(127, stderr)).toBe(
      'The local model runtime needs the system library libgomp.so.1 — install the libgomp1 package.',
    )
    expect(explainStartFailure(1, 'boom')).toContain('exited during start (1): boom')
  })
})
