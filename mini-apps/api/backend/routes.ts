/**
 * HTTP routes for the REST workbench UI, mounted at `/rpc/api`.
 *
 * User-scoped state reads `c.env.userId`, supplied by the host through `MiniAppRouteContext` for
 * every request. The router never captures boot-time identity or reads host headers/env vars.
 *
 * The routes serve the REDACTED view (`RequestInfo`), never the store's `SavedRequest`: the UI is
 * a browser, and a literal credential that reaches it is a credential in a devtools network tab.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import type { MiniAppRouteContext, MiniAppRouteScope } from '@localixai/mini-app-sdk/backend'
import { defaultErrorHandler } from '@localixai/mini-app-sdk/backend'
import type { SendResponse } from './contracts'
import { statusFor } from './errors'
import { HTTP_METHODS, isHttpUrl, type RequestSpec } from './request-spec'
import type { EnvironmentService } from './environments/service'
import { missingVarsProblem } from './render-spec'
import { renderEnvironmentForSend } from './render-environment'
import { hasTemplate } from './template'
import { RestError } from './errors'
import { resolveAuthSecrets, type ResolveSecret } from './secrets'
import { sendRequest } from './send'
import { recordSend } from './history'
import type { StoreSecret } from './vault-auth'
import type { BindSecret } from './vault-bindings'
import { collectionFor, environmentsFor } from './collection/for-scope'
import type { CollectionStore } from './collection/store'
import { registerEnvironmentRoutes } from './environment-routes'
import { registerImportRoute, registerRequestExportRoute } from './import-export-routes'
import { REQUEST_NOT_FOUND, toInfo, resolvedFor, restErrorBody } from './request-route-values'
import { validated, pairSchema, bodySchema } from './route-validation'
import { registerRequestEditRoutes } from './request-edit-routes'
import { registerRequestLifecycleRoutes } from './request-lifecycle-routes'

export interface RestRoutesDeps {
  /** Injected in tests; production resolves per request from `c.env.cwd`. */
  environments?: EnvironmentService
  resolveSecret: ResolveSecret
  /**
   * The vault WRITER, when a host bound one. Optional because the routes work without it — an
   * import driven from the workbench then leaves a pasted literal in place rather than vaulting it,
   * exactly as `runImportAction` does when no writer is present. Wire it (from `getStoreSecret()`)
   * to let a UI import move credentials into the vault the way the agent tool's import does.
   */
  storeSecret?: StoreSecret
  /**
   * Register a `${secret:KEY}` reference against the vault. Optional: a host without a binding
   * registry leaves references unrecorded, and everything else works exactly the same.
   */
  bindSecret?: BindSecret
  /**
   * Which collection a call reads. Defaults to the one at `c.env.cwd`, which is what production
   * wants: the host resolves the scope per request, so the routes follow the user's session.
   *
   * Injected in tests, where a temp directory per case would be slower and no more true — the
   * filesystem's own behaviour is pinned in `collection/store.test.ts`, and these routes are
   * about status codes and redaction.
   */
  collection?: (cwd: string | undefined, sessionId?: string) => CollectionStore
  /** Send settings, resolved from mini app config by the caller — routes own no config parsing. */
  send: { timeoutMs: number; maxBodyBytes: number; allowPrivateNetwork: boolean }
}

/**
 * The manual-create payload. Only `name` is required — a request minted with just a name and the
 * default method is a valid empty starting point the editor then fills in (create empty, edit,
 * save). `url` may be blank here; the PUT that saves the first
 * real edit is where the http-or-template rule is enforced.
 */
const createRequestSchema = z.object({
  name: z.string(),
  url: z.string().optional(),
  method: z.enum(HTTP_METHODS).optional(),
  headers: pairSchema.array().optional(),
  query: pairSchema.array().optional(),
  pathParameters: pairSchema.array().optional(),
  body: bodySchema,
})

const createFolderSchema = z.object({ name: z.string() })

export function createRestRoutes(deps: RestRoutesDeps) {
  // Typed with the host's per-request scope: `c.env.cwd` is the project this call belongs to,
  // and it is the ONLY place the collection's location comes from. A route that captured it
  // would serve the first project the process ever saw (see collection/for-scope.ts).
  const app = new Hono<MiniAppRouteContext>()
  const uid = (c: { env: MiniAppRouteScope }) => c.env.userId
  const sid = (c: { env?: Partial<MiniAppRouteScope> }) => c.env?.sessionId
  const resolveCollection = deps.collection ?? collectionFor
  const collection = (c: { env?: Partial<MiniAppRouteScope> }) =>
    resolveCollection(c.env?.cwd, sid(c))
  // Environments are part of the collection, so they follow the SAME scope. An injected
  // `environments` (tests) wins, exactly as an injected collection does.
  const resolveEnvironments = deps.environments
    ? () => deps.environments!
    : (cwd: string | undefined, sessionId?: string) => environmentsFor(cwd, sessionId)
  const envs = (c: { env?: Partial<MiniAppRouteScope> }) => resolveEnvironments(c.env?.cwd, sid(c))

  const requestRoutes = app
    .get('/requests', async (c) => {
      const all = await collection(c).list()
      return c.json({ requests: all.map(toInfo) })
    })

    .get('/folders', async (c) => {
      return c.json({ folders: (await collection(c).listFolders?.()) ?? [] })
    })

    .post('/folders', validated('json', createFolderSchema), async (c) => {
      const name = c.req.valid('json').name.trim()
      if (!name) {
        return c.json({ error: 'A folder name is required.', code: 'bad_request' as const }, 400)
      }
      const store = collection(c)
      if (!store.createFolder) {
        return c.json(
          { error: 'This collection does not support folders.', code: 'invalid_request' as const },
          422,
        )
      }
      const created = await store.createFolder(name)
      if (!created.ok) {
        return c.json({ error: created.problem, code: 'invalid_request' as const }, 422)
      }
      return c.json({ folder: created.name }, 201)
    })

    .delete('/folders/:name', async (c) => {
      const store = collection(c)
      if (!store.removeFolder) {
        return c.json(
          { error: 'This collection does not support folders.', code: 'invalid_request' as const },
          422,
        )
      }
      const removed = await store.removeFolder(c.req.param('name'))
      if (!removed.ok) {
        return c.json({ error: removed.problem, code: 'invalid_request' as const }, 422)
      }
      return c.json({ ok: true })
    })

    // Mint a new request from the UI. The name IS the identity, so a collision is a 409 rather than
    // a silent overwrite — the sidebar surfaces it and lets the user pick another name.
    .post('/requests', validated('json', createRequestSchema), async (c) => {
      const input = c.req.valid('json')
      const name = input.name.trim()
      if (name === '') {
        return c.json(
          {
            error: 'A name is required.',
            code: 'bad_request' as const,
            detail: 'Give the request a short name — it is how you and the agent refer to it.',
          },
          400,
        )
      }
      const url = input.url?.trim() ?? ''
      // A blank url is allowed at CREATE (an empty request you flesh out); a non-blank one must be
      // http(s) or a `{{template}}`, the same rule the PUT enforces on save.
      if (url !== '' && !hasTemplate(url) && !isHttpUrl(url)) {
        return c.json(
          {
            error: `"${url}" is not an http(s) URL.`,
            code: 'bad_request' as const,
            detail:
              'Write the full URL including the scheme, or use a variable like `{{base_url}}/users`.',
          },
          400,
        )
      }
      if (await collection(c).get(name)) {
        return c.json(
          {
            error: `A request named "${name}" already exists.`,
            code: 'name_taken' as const,
            detail: 'Pick a different name, or open the existing one.',
          },
          409,
        )
      }
      const spec: RequestSpec = {
        url,
        method: input.method ?? 'GET',
        headers: input.headers ?? [],
        query: input.query ?? [],
        auth: { type: 'none' },
      }
      if (input.pathParameters?.length) spec.pathParameters = input.pathParameters
      if (input.body) spec.body = input.body
      const userId = uid(c)
      const created = await collection(c).save(name, spec)
      if (!created.ok) {
        return c.json({ error: created.problem, code: 'invalid_request' as const }, 422)
      }
      return c.json(
        {
          request: toInfo(created.request),
          resolved: await resolvedFor(envs(c), userId, created.request),
        },
        201,
      )
    })

    .get('/requests/:name', async (c) => {
      const userId = uid(c)
      const saved = await collection(c).get(c.req.param('name'))
      if (!saved) return c.json(REQUEST_NOT_FOUND, 404)
      return c.json({ request: toInfo(saved), resolved: await resolvedFor(envs(c), userId, saved) })
    })

  const environmentRoutes = registerEnvironmentRoutes(requestRoutes, { uid, envs })
  const importedRoutes = registerImportRoute(environmentRoutes, { uid, collection, envs, deps })
  const editedRoutes = registerRequestEditRoutes(importedRoutes, { uid, collection, envs, deps })
  const historyRoutes = registerRequestLifecycleRoutes(editedRoutes, { uid, sid, collection })

  const routes = registerRequestExportRoute(historyRoutes, { collection })
    /**
     * Send a saved request and return its response.
     *
     * This is the ONE route that resolves secrets, and it resolves them from the STORED spec —
     * never from anything the browser sent. A route that accepted a spec in its body would let
     * any page that can reach this port make us send arbitrary requests with the user's vaulted
     * credentials attached. Sending by NAME means the credential is only ever spent on the
     * request the user themselves saved.
     */
    .post('/requests/:name/send', async (c) => {
      const userId = uid(c)
      const saved = await collection(c).get(c.req.param('name'))
      if (!saved) return c.json(REQUEST_NOT_FOUND, 404)
      try {
        // The SAME render the agent's send does. A UI Send that skipped it would resolve
        // variables differently from the tool — one surface silently sending somewhere else.
        const rendered = await renderEnvironmentForSend(saved.spec, envs(c), userId, saved.name)
        if (rendered.safe.missing.length > 0) {
          throw new RestError(
            'bad_request',
            missingVarsProblem(rendered.safe.missing, await envs(c).activeName(userId)),
          )
        }
        if (rendered.wire.problems.length > 0) {
          throw new RestError('bad_request', rendered.wire.problems.join(' '))
        }
        // The request's timeout override wins over the mini app default. Validated positive HERE
        // rather than trusting the stored value: a spec from an import or an older schema could
        // carry a non-positive number the PUT schema would now reject, and the send path is the one
        // that must refuse to act on it.
        const timeoutMs = saved.spec.timeoutMs ?? deps.send.timeoutMs
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
          throw new RestError(
            'bad_request',
            `This request's timeout (${saved.spec.timeoutMs}ms) must be a positive number of milliseconds.`,
          )
        }
        const auth = await resolveAuthSecrets(userId, rendered.wire.spec.auth, deps.resolveSecret)
        // `c.req.raw.signal` aborts the fetch when the BROWSER closes the connection — a user who
        // navigates away or hits stop should not leave the send running against the upstream. It is
        // combined with the timeout inside `sendRequest` (one signal for the whole redirect chain).
        const res: SendResponse = await sendRequest(
          { ...rendered.wire.spec, auth },
          {
            ...deps.send,
            timeoutMs,
            signal: c.req.raw.signal,
            secretValues: rendered.secretValues,
          },
        )
        // 'user': this is the workbench's own Send. The agent's send records 'agent'. The rendered
        // spec is snapshotted (redacted, inside recordSend) so the row shows what was actually sent.
        recordSend(userId, saved.name, res, 'user', rendered.safe.spec, sid(c))
        return c.json(res)
      } catch (err) {
        return c.json(restErrorBody(err), statusFor(err))
      }
    })

  routes.onError(defaultErrorHandler)
  return routes
}
