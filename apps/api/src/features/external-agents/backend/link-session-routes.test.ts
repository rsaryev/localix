import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import type { HostRouteContext } from '@localixai/mini-app-sdk/backend'
import type { SessionDetail } from '../../chat/contracts'
import { ApiError } from '../../../lib/errors'
import { createLinkAgentRoutes } from './link-session-routes'

function fixture(kind: SessionDetail['sessionKind'] = 'chat') {
  let session = { id: 'our-chat', projectId: 'project', sessionKind: kind } as SessionDetail
  const updates: { id: string; provider: string }[] = []
  const app = new Hono<HostRouteContext>()
    .use('*', async (c, next) => {
      c.set('userId', 'user')
      await next()
    })
    .route(
      '/',
      createLinkAgentRoutes(
        {
          session: async (_user, id) => {
            if (id !== 'our-chat') throw new ApiError(404, 'not_found', 'Session not found')
            return session
          },
          link: async (_user, id, provider) => {
            updates.push({ id, provider })
            session = { ...session, externalAgentProvider: provider }
            return session
          },
        },
        async () => [
          { id: 'codex', name: 'Codex', command: 'codex' },
          { id: 'claude-code', name: 'Claude Code', command: 'claude' },
        ],
      ),
    )
  const link = (provider = 'codex', sessionId = 'our-chat') =>
    app.request('/link-agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, sessionId }),
    })
  return { link, updates }
}

test('links an installed CLI to the same ordinary chat and repeated links are idempotent', async () => {
  const { link, updates } = fixture()
  expect(await (await link()).json()).toMatchObject({
    id: 'our-chat',
    externalAgentProvider: 'codex',
  })
  expect((await link()).status).toBe(200)
  expect(updates).toEqual([{ id: 'our-chat', provider: 'codex' }])
})

test('foreign owners, absent CLIs and worker sessions cannot be linked', async () => {
  const { link, updates } = fixture()
  expect((await link('codex', 'foreign-chat')).status).toBe(404)
  expect((await link('not-installed')).status).toBe(404)
  expect(updates).toEqual([])
  const worker = fixture('subagent')
  expect((await worker.link()).status).toBe(400)
  expect(worker.updates).toEqual([])
})

test('concurrent choices cannot overwrite an already linked agent', async () => {
  const { link, updates } = fixture()
  const results = await Promise.all([link('codex'), link('claude-code')])
  expect(results.map((result) => result.status)).toEqual([200, 409])
  expect(updates).toEqual([{ id: 'our-chat', provider: 'codex' }])
})
