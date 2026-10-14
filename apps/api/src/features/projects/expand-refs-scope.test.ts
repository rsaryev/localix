import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { ApiError } from '../../lib/errors'
import { expandRefsRequestSchema } from './contracts'
import { createProjectsService } from './service'

const tempDir = join(process.cwd(), 'tmp', 'expand-refs-scope-tests')

/**
 * The directory a composer's refs expand against is the SERVER's answer for the sending session.
 * The defect: the client sent a `rootSessionId` that became `~/.localix/workspace/<id>` with no
 * ownership check, so naming another chat's root read files from its sandbox.
 */
describe('expandRefs — the session decides the directory, after an ownership check', () => {
  let db: any
  let sandbox: string
  let service: ReturnType<typeof createProjectsService>

  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
    sandbox = join(tempDir, `sandbox-${randomUUID()}`)
    await mkdir(sandbox, { recursive: true })
    await writeFile(join(sandbox, 'notes.txt'), 'owned sandbox\n')
    db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    service = createProjectsService({
      db,
      resolveSessionCwd: async (userId, sessionId) => {
        if (userId === 'u1' && sessionId === 'chat-1') return sandbox
        throw new ApiError(404, 'session_not_found', 'Session not found')
      },
    })
  })

  afterAll(async () => {
    await destroyDatabase(db)
    await rm(tempDir, { recursive: true, force: true })
  })

  const fileRef = { raw: '@file:notes.txt', kind: 'file' as const, path: 'notes.txt' }

  test("an owned session's refs expand in the directory the server resolves for it", async () => {
    const result = await service.expandRefs('u1', { sessionId: 'chat-1', refs: [fileRef] })
    expect(result.workingDir).toBe(sandbox)
    expect(result.expansions[0]).toMatchObject({ ok: true })
    expect(result.expansions[0]?.content).toContain('owned sandbox')
  })

  test('a session the caller does not own is rejected, not expanded', async () => {
    await expect(
      service.expandRefs('intruder', { sessionId: 'chat-1', refs: [fileRef] }),
    ).rejects.toMatchObject({ status: 404, code: 'session_not_found' })
  })

  test('a client-sent root id is no scope at all', async () => {
    // The schema no longer carries it, so it is stripped before the service sees the request.
    const parsed = expandRefsRequestSchema.parse({ rootSessionId: 'chat-1', refs: [fileRef] })
    expect('rootSessionId' in parsed).toBe(false)
    await expect(service.expandRefs('u1', parsed)).rejects.toMatchObject({
      status: 400,
      code: 'missing_scope',
    })
  })
})
