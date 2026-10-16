import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createChatRoutes, type ChatRoutesService } from './routes'
import { readFile } from './service/file-ops'
import type { FileOpsContext } from './service/file-ops'
import type { SessionRecord } from './repository'

/**
 * The conditional read was verified at the SERVICE seam — `readFile` returns an
 * empty `content` when the caller's hash still matches. That is not the claim that
 * matters. The claim is that the body does not cross the WIRE, and between the
 * service and the wire sit a route, a validator and JSON serialization, none of
 * which were exercised.
 *
 * So this drives the real Hono route with the real file service over a real file,
 * and measures the serialized response.
 */

let dir: string

const service = () => {
  const ctx: FileOpsContext = {
    requireSession: async () =>
      ({ id: 'session-a', executionBackend: 'local' }) as unknown as SessionRecord,
    resolveSessionWorkingDir: async () => dir,
  }
  return {
    readFile: (
      _userId: string,
      _sessionId: string,
      filePath: string,
      opts?: { full?: boolean; knownHash?: string },
    ) => readFile(ctx, 'u', 'session-a', filePath, opts),
  } as unknown as ChatRoutesService
}

const get = (query: string) =>
  createChatRoutes(service()).request(new Request(`http://local/sessions/session-a/file?${query}`))

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'condread-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('conditional file read, measured at the wire', () => {
  test('a matching hash answers without the body', async () => {
    const body = 'export const x = 1\n'.repeat(4000) // ~76 KB
    writeFileSync(path.join(dir, 'big.ts'), body)

    const first = await get('path=big.ts&full=1')
    const firstText = await first.text()
    const parsed = JSON.parse(firstText) as { content: string; hash: string }
    expect(parsed.content).toBe(body)

    const second = await get(`path=big.ts&full=1&knownHash=${parsed.hash}`)
    const secondText = await second.text()

    expect(second.status).toBe(200)
    expect(JSON.parse(secondText)).toMatchObject({ unchanged: true, hash: parsed.hash })
    // The whole point, stated as bytes on the wire rather than as a field value.
    expect(firstText.length).toBeGreaterThan(70_000)
    expect(secondText.length).toBeLessThan(500)
  })

  test('a stale hash still ships the new content', async () => {
    writeFileSync(path.join(dir, 'a.ts'), 'one')
    const first = JSON.parse(await (await get('path=a.ts&full=1')).text()) as { hash: string }
    writeFileSync(path.join(dir, 'a.ts'), 'two')

    const second = JSON.parse(await (await get(`path=a.ts&full=1&knownHash=${first.hash}`)).text())

    expect(second).toMatchObject({ content: 'two' })
    expect(second.unchanged).toBeUndefined()
  })

  test('the query parameter survives validation — an unknown hash is not silently dropped', async () => {
    // A `knownHash` the schema rejected would fall through to a full read and the
    // saving would vanish with nothing failing. Pin that it reaches the service.
    writeFileSync(path.join(dir, 'a.ts'), 'one')
    const first = JSON.parse(await (await get('path=a.ts&full=1')).text()) as { hash: string }

    const echoed = await get(`path=a.ts&full=1&knownHash=${first.hash}`)

    expect(JSON.parse(await echoed.text())).toMatchObject({ unchanged: true })
  })
})
