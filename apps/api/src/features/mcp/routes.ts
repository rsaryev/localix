import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'
import { z } from 'zod'

import { escapeHtml } from '../../lib/html-escape'
import { defaultErrorHandler } from '../../lib/http'
import type { AppContext } from '../../app'
import {
  importMcpServersRequestSchema,
  importMcpServersResponseSchema,
  mcpServerInputSchema,
  mcpServerSchema,
  startMcpOAuthResponseSchema,
  testMcpServerResponseSchema,
  type ImportMcpServersResponse,
  type McpServer,
  type McpServerInput,
  type McpServerStatus,
} from './contracts'
import type { FinishAuthResult, StartAuthResult } from './oauth/flow'

export interface McpRoutesService {
  listServers(
    userId: string,
    opts?: { projectId?: string | null },
  ): Promise<{ servers: McpServer[] }>
  createServer(userId: string, input: McpServerInput): Promise<McpServer>
  updateServer(userId: string, id: string, input: McpServerInput): Promise<McpServer>
  setServerEnabled(userId: string, id: string, enabled: boolean): Promise<McpServer>
  deleteServer(userId: string, id: string): Promise<void>
  testServer(userId: string, id: string): Promise<McpServerStatus>
  importServers(
    userId: string,
    payload: { mcpServers: Record<string, Record<string, unknown>>; defaultEnabled?: boolean },
    projectId: string | null,
  ): Promise<ImportMcpServersResponse>
  startServerOAuth(userId: string, id: string): Promise<StartAuthResult>
  finishServerOAuth(state: string, code: string): Promise<FinishAuthResult>
  logoutServerOAuth(userId: string, id: string): Promise<void>
}

const idParamSchema = z.object({ id: z.string().min(1) })

/** Minimal self-closing HTML shown in the popped-open browser tab after the callback. */
function callbackHtml(result: FinishAuthResult): string {
  const ok = result.ok
  const title = ok ? 'Signed in' : 'Sign-in failed'
  const detail = ok
    ? `Connected${result.serverName ? ` to <b>${escapeHtml(result.serverName)}</b>` : ''}. You can close this tab.`
    : escapeHtml(result.error ?? 'Something went wrong.')
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px system-ui;margin:3rem;color:#111"><h2 style="margin:0 0 .5rem">${title}</h2><p>${detail}</p><script>setTimeout(()=>window.close(),1500)</script></body>`
}

export function createMcpRoutes(service: McpRoutesService) {
  const app = new Hono<AppContext>()

  const routes = app
    .post('/servers', zValidator('json', mcpServerInputSchema), async (c) => {
      const response = await service.createServer(c.get('userId'), c.req.valid('json'))
      return c.json(mcpServerSchema.parse(response), 201)
    })
    .post('/servers/import', zValidator('json', importMcpServersRequestSchema), async (c) => {
      const { mcpServers, servers, projectId, defaultEnabled } = c.req.valid('json')
      const response = await service.importServers(
        c.get('userId'),
        { mcpServers: mcpServers ?? servers ?? {}, defaultEnabled },
        projectId ?? null,
      )
      return c.json(importMcpServersResponseSchema.parse(response), 200)
    })
    .put(
      '/servers/:id',
      zValidator('param', idParamSchema),
      zValidator('json', mcpServerInputSchema),
      async (c) => {
        const response = await service.updateServer(
          c.get('userId'),
          c.req.valid('param').id,
          c.req.valid('json'),
        )
        return c.json(mcpServerSchema.parse(response), 200)
      },
    )
    .post('/servers/:id/test', zValidator('param', idParamSchema), async (c) => {
      const response = await service.testServer(c.get('userId'), c.req.valid('param').id)
      return c.json(testMcpServerResponseSchema.parse(response), 200)
    })
    .delete('/servers/:id', zValidator('param', idParamSchema), async (c) => {
      await service.deleteServer(c.get('userId'), c.req.valid('param').id)
      return c.body(null, 204)
    })
    // Begin an interactive OAuth sign-in — returns the authorization URL for the
    // client to open in a browser (or `authenticated` when already signed in).
    .post('/servers/:id/oauth/start', zValidator('param', idParamSchema), async (c) => {
      const response = await service.startServerOAuth(c.get('userId'), c.req.valid('param').id)
      return c.json(startMcpOAuthResponseSchema.parse(response), 200)
    })
    // Forget stored tokens for a remote server (sign out).
    .post('/servers/:id/oauth/logout', zValidator('param', idParamSchema), async (c) => {
      await service.logoutServerOAuth(c.get('userId'), c.req.valid('param').id)
      return c.body(null, 204)
    })
    // Loopback redirect target the authorization server sends the browser back to.
    // Correlated to its pending flow by `state`; returns a tiny self-closing page.
    .get(
      '/oauth/callback',
      zValidator(
        'query',
        z.object({
          code: z.string().optional(),
          state: z.string().optional(),
          error: z.string().optional(),
        }),
      ),
      async (c) => {
        const { code, state, error } = c.req.valid('query')
        if (error) return c.html(callbackHtml({ ok: false, error }), 400)
        if (!code || !state)
          return c.html(callbackHtml({ ok: false, error: 'Missing code or state' }), 400)
        const result = await service.finishServerOAuth(state, code)
        return c.html(callbackHtml(result), result.ok ? 200 : 400)
      },
    )

  routes.onError(defaultErrorHandler)

  return routes
}
