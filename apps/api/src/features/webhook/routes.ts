import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'
import { z } from 'zod'
import type { AppContext } from '../../app'
import { jsonError } from '../../lib/http'
import { WEBHOOK_MESSAGES_SUBPATH } from '../../lib/runtime-address'
import type { MessageMutationResponse, WakeSource } from '../chat/contracts'
import { wrapInboundMessage } from './wrap'

/**
 * The one capability the webhook needs: deliver a message into a chat session,
 * tagged with a provenance `origin`. Satisfied by the chat service's `sendMessage`
 * — the SAME entry the frontend uses — so an inbound webhook and a typed message
 * run through identical slash/plugin/skill/ref/busy-queue handling. The only
 * difference is the `origin: 'external'` tag on the persisted user row.
 */
export interface WebhookRoutesService {
  sendMessage(
    userId: string,
    sessionId: string,
    prompt: string,
    bindings?: undefined,
    origin?: WakeSource,
  ): Promise<MessageMutationResponse>
}

const messageBody = z.object({
  sessionId: z.string().min(1),
  /** Capped at 64KB so an external CLI can't dump a whole diff/log into session context. */
  prompt: z.string().min(1).max(65536),
  /** Free label of the calling system (e.g. "claude-code", "ci", "uptime"). Shown
   *  to the model in the provenance line; the structural tag stays `external`. */
  source: z.string().max(120).optional(),
})

const failMessage = (err: unknown) => (err instanceof Error ? err.message : 'Webhook send failed')

/**
 * Inbound webhook (`/rpc/webhook`). A SEPARATE surface from the frontend send path
 * so an external-origin message is identifiable — structurally (this route +
 * `origin: 'external'` on the row) and to the model (the wrapped provenance line).
 *
 * Local-first auth is unchanged: the request runs as `x-user-id` or the default
 * user (same middleware as every other `/rpc` route). It does not open a new
 * trust boundary — the loopback CORS policy still applies.
 */
export function createWebhookRoutes(service: WebhookRoutesService) {
  const app = new Hono<AppContext>()

  return app.post(WEBHOOK_MESSAGES_SUBPATH, zValidator('json', messageBody), async (c) => {
    const userId = c.get('userId')
    const { sessionId, prompt, source } = c.req.valid('json')
    try {
      const result = await service.sendMessage(
        userId,
        sessionId,
        wrapInboundMessage(prompt, source),
        undefined,
        'external',
      )
      return c.json({
        ok: true,
        sessionId: result.sessionId,
        messageId: result.messageId,
        queued: result.queued ?? false,
      })
    } catch (err) {
      return jsonError(c, 409, 'webhook_send_failed', failMessage(err))
    }
  })
}
