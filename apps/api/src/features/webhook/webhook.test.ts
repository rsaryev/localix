import { Hono } from 'hono'
import { describe, expect, test } from 'bun:test'

import type { AppContext } from '../../app'
import { createWebhookRoutes, type WebhookRoutesService } from './routes'
import { wrapInboundMessage } from './wrap'

const USER = 'u'

interface Call {
  userId: string
  sessionId: string
  prompt: string
  origin: string | undefined
}

function freshApp(impl?: WebhookRoutesService['sendMessage']) {
  const calls: Call[] = []
  const service: WebhookRoutesService = {
    sendMessage:
      impl ??
      (async (userId, sessionId, prompt, _bindings, origin) => {
        calls.push({ userId, sessionId, prompt, origin })
        return { sessionId, messageId: 'm1' }
      }),
  }
  const app = new Hono<AppContext>()
  app.use('*', async (c, next) => {
    c.set('userId', USER)
    await next()
  })
  app.route('/rpc/webhook', createWebhookRoutes(service))
  return { app, calls }
}

const post = (app: Hono<AppContext>, body: unknown) =>
  app.request('/rpc/webhook/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('wrapInboundMessage', () => {
  test('names the source system when given', () => {
    const w = wrapInboundMessage('do X', 'claude-code')
    expect(w).toContain('external system "claude-code"')
    expect(w).toContain('not typed by the user')
    expect(w.endsWith('do X')).toBe(true)
  })

  test('still marks provenance when no source is given', () => {
    const w = wrapInboundMessage('do X')
    expect(w).toContain('external system —')
    expect(w.endsWith('do X')).toBe(true)
  })
})

describe('POST /rpc/webhook/messages', () => {
  test('delivers with origin=external and a wrapped, source-labelled prompt', async () => {
    const { app, calls } = freshApp()
    const res = await post(app, { sessionId: 's1', prompt: 'ship it', source: 'ci' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, sessionId: 's1', messageId: 'm1', queued: false })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.userId).toBe(USER)
    expect(calls[0]!.sessionId).toBe('s1')
    expect(calls[0]!.origin).toBe('external')
    expect(calls[0]!.prompt).toContain('ship it')
    expect(calls[0]!.prompt).toContain('"ci"')
  })

  test('reflects a queued send', async () => {
    const { app } = freshApp(async (_sessionId) => ({
      sessionId: 's1',
      messageId: '',
      queued: true,
    }))
    const res = await post(app, { sessionId: 's1', prompt: 'later' })
    expect(res.status).toBe(200)
    expect((await res.json()).queued).toBe(true)
  })

  test('rejects a missing prompt with 400', async () => {
    const { app } = freshApp()
    const res = await post(app, { sessionId: 's1' })
    expect(res.status).toBe(400)
  })

  test('rejects an over-length prompt with 400', async () => {
    const { app, calls } = freshApp()
    const res = await post(app, { sessionId: 's1', prompt: 'x'.repeat(65537) })
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  test('accepts a prompt at the 64KB limit', async () => {
    const { app, calls } = freshApp()
    const res = await post(app, { sessionId: 's1', prompt: 'x'.repeat(65536) })
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })

  test('surfaces a service failure as 409', async () => {
    const { app } = freshApp(async () => {
      throw new Error('session not mutable')
    })
    const res = await post(app, { sessionId: 's1', prompt: 'x' })
    expect(res.status).toBe(409)
    expect((await res.json()).error.message).toContain('session not mutable')
  })
})
