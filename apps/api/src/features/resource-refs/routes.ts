import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'
import { z } from 'zod'
import type { AppContext } from '../../app'
import { defaultErrorHandler } from '../../lib/http'
import type { ResourceProviderRegistry } from '../agent-core/resource-refs/provider'

export const MAX_RESOURCE_PARTIAL_BYTES = 4 * 1024
const utf8 = new TextEncoder()
// oxlint-disable-next-line no-control-regex -- URI/picker control bytes are never data
const CONTROL_CHARACTER = /[\x00-\x1f\x7f-\x9f]/

function decodedTraversal(value: string): boolean {
  let decoded = value
  for (let depth = 0; depth < 2; depth += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      break
    }
  }
  return decoded.split(/[\\/]/).some((segment) => segment === '.' || segment === '..')
}

const resourceBrowseQuerySchema = z.object({
  partial: z
    .string()
    .refine(
      (value) => utf8.encode(value).byteLength <= MAX_RESOURCE_PARTIAL_BYTES,
      'Resource partial is too large',
    )
    .refine((value) => !CONTROL_CHARACTER.test(value), 'Resource partial contains control bytes')
    .refine((value) => !decodedTraversal(value), 'Resource partial contains path traversal')
    .optional(),
  sessionId: z.string().trim().min(1).max(200).optional(),
})

/**
 * Drill-down backend for the composer `@resource:` menu + drag. ONE read route
 * over the agnostic `ResourceProviderRegistry`:
 *
 *   GET /rpc/resource-refs?partial=         → provider ROOTS (top of the menu)
 *   GET /rpc/resource-refs?partial=localix://resource/catalog/x/  → children of that node
 *   GET /rpc/resource-refs?partial=…/ord    → canonical provider + server search
 *
 * Ownership-scoped by `userId`; session-owned providers also receive the active
 * `sessionId`, so their browse trees cannot leak across chats. Node EXPANSION
 * (the model-facing text) is NOT exposed here — it flows only through the send-time ref pipeline
 * (`projects/expand-refs` → `resourceRegistry.expand`), so this route can never be
 * used to exfiltrate a resolved secret.
 *
 * The session id reaches a provider only after `assertSessionAccess` passed. It used to travel
 * from the query string straight into the provider scope, so a provider that keys its tree by
 * session (a course, a board) listed another user's — or a deleted chat's — nodes for whoever
 * named the id. A session the caller does not own is rejected (the gate's 404); no `sessionId`
 * stays "no session scope".
 */
export function createResourceRefRoutes(
  registry: ResourceProviderRegistry,
  deps: {
    /** Rejects (ApiError 404) for a session that is missing or not the user's. */
    assertSessionAccess: (userId: string, sessionId: string) => Promise<void>
  },
) {
  return new Hono<AppContext>()
    .get('/', zValidator('query', resourceBrowseQuerySchema), async (c) => {
      const userId = c.get('userId')
      const partial = c.req.valid('query').partial ?? ''
      const sessionId = c.req.valid('query').sessionId
      if (sessionId) await deps.assertSessionAccess(userId, sessionId)
      const result = await registry.browse(userId, partial, { sessionId })
      return c.json(result)
    })
    .onError(defaultErrorHandler)
}
