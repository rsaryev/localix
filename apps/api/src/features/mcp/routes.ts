import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'
import { z } from 'zod'

import { escapeHtml } from '../../lib/html-escape'
import { defaultErrorHandler } from '../../lib/http'
import type { AppContext } from '../../app'
import type { FinishAuthResult } from './oauth/flow'

/** What the OAuth callback asks of the MCP service: finishing a sign-in the Store started. */
export interface McpRoutesService {
  finishServerOAuth(state: string, code: string): Promise<FinishAuthResult>
}

/** Minimal self-closing HTML shown in the popped-open browser tab after the callback. */
function callbackHtml(result: FinishAuthResult): string {
  const ok = result.ok
  const title = ok ? 'Signed in' : 'Sign-in failed'
  const detail = ok
    ? `Connected${result.serverName ? ` to <b>${escapeHtml(result.serverName)}</b>` : ''}. You can close this tab.`
    : escapeHtml(result.error ?? 'Something went wrong.')
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px system-ui;margin:3rem;color:#111"><h2 style="margin:0 0 .5rem">${title}</h2><p>${detail}</p><script>setTimeout(()=>window.close(),1500)</script></body>`
}

/**
 * The one MCP route: the loopback redirect the authorization server sends the browser back to.
 * Servers are added, configured, tested and signed in from the Store (`store-provider.ts`).
 */
export function createMcpRoutes(service: McpRoutesService) {
  const app = new Hono<AppContext>()

  const routes = app.get(
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
