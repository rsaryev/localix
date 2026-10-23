import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bindMiniAppUiTransport } from '@localixai/mini-app-sdk/ui/transport'
import { createResumeRoutes } from '../backend/routes'
import { createResumeService } from '../backend/service'
import { emptyDocument } from '../shared/schema'
import { resumeApi } from './api'

test('opens an empty library and creates a resume through the actual mounted root route', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'resume-route-'))
  const app = new Hono().route('/rpc/resume', createResumeRoutes(createResumeService))
  const requests: string[] = []
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      requests.push(`${init?.method ?? 'GET'} ${path}`)
      return app.request(`http://localhost${path}`, init, {
        userId: 'test-user',
        sessionId: 'test-session',
        projectId: '',
        cwd: dir,
      })
    },
  })
  try {
    expect(await resumeApi.list('test-session')).toEqual([])
    const created = await resumeApi.create('test-session', emptyDocument('First resume'))
    expect((await resumeApi.list('test-session'))[0]?.id).toBe(created.id)
    expect((await resumeApi.get('test-session', created.id)).document.title).toBe('First resume')
    expect(requests.slice(0, 2)).toEqual([
      'GET /rpc/resume?sessionId=test-session',
      'POST /rpc/resume?sessionId=test-session',
    ])
  } finally {
    unbind()
    await rm(dir, { recursive: true, force: true })
  }
})
