/**
 * HTTP routes for the REST workbench UI, mounted at `/rpc/api`.
 *
 * User-scoped state reads `c.env.userId`, supplied by the host through `PluginRouteContext` for
 * every request. The router never captures boot-time identity or reads host headers/env vars.
 *
 * The routes serve the REDACTED view (`RequestInfo`), never the store's `SavedRequest`: the UI is
 * a browser, and a literal credential that reaches it is a credential in a devtools network tab.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import type { PluginRouteContext, PluginRouteScope } from '@localixai/plugin-sdk/backend'
import { defaultErrorHandler } from '@localixai/plugin-sdk/backend'
import type {
  ExportFormat,
  ImportResponse,
  RequestInfo,
  ResolvedPreview,
  RestErrorResponse,
  SendResponse,
} from './contracts'
import { EXPORT_FORMATS } from './contracts'
import { mapRestError, statusFor, toErrorInfo } from './errors'
import { redactSpec } from './store'
import { mergeAuth } from './auth-edit'
import { HTTP_METHODS, isHttpUrl, type RequestSpec } from './request-spec'
import type { EnvironmentService } from './environments/service'
import { missingVarsProblem, renderSpec } from './render-spec'
import { renderEnvironmentForSend } from './render-environment'
import { hasTemplate } from './template'
import { RestError } from './errors'
import { resolveAuthSecrets, type ResolveSecret } from './secrets'
import { sendRequest } from './send'
import { dropHistory, listHistory, recordSend, renameHistory } from './history'
import { runImportAction, uniqueNames } from './import-action'
import { runImport } from './import/registry'
import { toCurl } from './export/curl'
import type { StoreSecret } from './vault-auth'
import { bindAuthSecrets, type BindSecret } from './vault-bindings'
import { vaultLiteralAuth } from './vault-auth'
import { collectionFor, environmentsFor } from './collection/for-scope'
import type { CollectionRequest, CollectionStore } from './collection/store'
import { registerEnvironmentRoutes } from './environment-routes'
import { validated, pairSchema } from './route-validation'

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
  /** Send settings, resolved from plugin config by the caller — routes own no config parsing. */
  send: { timeoutMs: number; maxBodyBytes: number; allowPrivateNetwork: boolean }
}

/**
 * The 404 bodies.
 *
 * `error` is the sentence a surface puts on its line; `code` is the classification a caller
 * branches on. Both fields used to carry the CODE, so a person whose request had been renamed
 * elsewhere read the words `request_not_found` on the sidebar — the same defect the Database
 * workbench shipped and fixed.
 */
const REQUEST_NOT_FOUND = {
  error: 'No saved request by that name.',
  code: 'request_not_found' as const,
}
/** Serialize any thrown value into the typed `{ error, code, detail }` body. */
function restErrorBody(err: unknown): RestErrorResponse {
  const info = toErrorInfo(mapRestError(err))
  return { error: info.message, code: info.code, detail: info.detail }
}

/**
 * What the UI may change about a request in ONE PUT.
 *
 * `auth` is absent HERE, but it is no longer un-editable from the browser: it has its own route
 * (`PUT /requests/:name/auth`) precisely because it needs the keep-the-masked-secret merge that
 * the whole-spec replace this schema drives cannot express. Splitting it keeps this PUT a blunt
 * "replace these fields" while auth gets the careful merge it requires.
 *
 * BE CLEAR ABOUT WHAT THAT DOES AND DOES NOT BUY. The auth route never hands the browser a stored
 * secret — the wire is redacted, and a field left masked is kept, not read — so editing auth adds
 * NO exfiltration path. What editing a URL and pressing Send does (spend a request's credential at
 * an edited host) is unchanged: that residual is real, pre-existing, and not a hole a schema can
 * close — the same origin already has `plugins/database`'s `/:id/query`, i.e. arbitrary SQL, under
 * identical rules. It is recorded so nobody reads this file and believes more is guaranteed than
 * is. A comment that overstates a guarantee is worse than none — it stops the next person looking.
 *
 * `validated('json')` is likewise load-bearing rather than stylistic. It enforces the JSON
 * content-type, and a JSON content-type is what forces a cross-origin PREFLIGHT — which our CORS
 * denies for any non-localhost origin. A handler reading `c.req.json()` directly parses a body
 * whatever its content-type, so a `text/plain` POST (a SIMPLE request: no preflight, delivered by
 * every browser) would reach it straight from a hostile page. Measured, not assumed: raw
 * `c.req.json()` happily parsed a `text/plain` payload; the JSON validator refused it. Do not "simplify"
 * this away.
 */
const bodySchema = z
  .object({
    mimeType: z.string().optional(),
    text: z.string().optional(),
    form: pairSchema.array().optional(),
  })
  .optional()

const updateRequestSchema = z.object({
  url: z.string(),
  method: z.enum(HTTP_METHODS),
  headers: pairSchema.array(),
  query: pairSchema.array(),
  pathParameters: pairSchema.array().optional(),
  body: bodySchema,
  // Per-request send settings. Absent on a PUT means "clear it, use the default" — the same
  // PUT-replaces rule the body and path-params follow (see the handler). `timeoutMs`/`maxRedirects`
  // are validated positive HERE so a bad value is a 400 at the boundary, never a stored footgun.
  followRedirects: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
  maxRedirects: z.number().int().positive().optional(),
})

/**
 * The workbench import payload. `source` is pasted text (a cURL command, an OpenAPI/Swagger spec, a
 * Postman/Insomnia export, a HAR). `save` writes them; absent/false is a preview. `dir` is accepted
 * for wire-parity with the agent tool but refused here — reading repo files needs the plugin's
 * working directory, which the tool has and these routes do not.
 */
const importSchema = z.object({
  source: z.string().optional(),
  save: z.boolean().optional(),
  dir: z.string().optional(),
  baseUrl: z.string().optional(),
})

/**
 * The auth block, editable from the UI. A secret-bearing field left equal to the redaction mask
 * (`••••••`) means "keep the stored secret" — see `mergeAuth`. A `${secret:KEY}` reference or a
 * fresh literal overwrites. Auth type can change freely (none → bearer, etc.).
 */
const authSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('basic'), username: z.string(), password: z.string() }),
  z.object({ type: z.literal('bearer'), token: z.string(), prefix: z.string().optional() }),
  z.object({
    type: z.literal('apikey'),
    key: z.string(),
    value: z.string(),
    addTo: z.enum(['header', 'query', 'cookie']).optional(),
  }),
])

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

/**
 * What a request resolves to right now, or undefined when it uses no variables.
 *
 * Computed on the READ, not cached: the active environment changes under a tab that is already
 * open, and a preview that went stale would say the request points somewhere it no longer does —
 * which is exactly the confusion environments exist to remove.
 */
async function resolvedFor(
  environments: EnvironmentService,
  userId: string,
  saved: CollectionRequest,
): Promise<ResolvedPreview | undefined> {
  if (!hasTemplate(saved.spec.url)) return undefined
  const rendered = renderSpec(saved.spec, await environments.activeVars(userId))
  return {
    url: rendered.spec.url,
    missing: rendered.missing,
    environment: await environments.activeName(userId),
  }
}

/** The wire view of a stored record — redacted, always. */
function toInfo(saved: CollectionRequest): RequestInfo {
  return {
    name: saved.name,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
    spec: redactSpec(saved.spec),
  }
}

export function createRestRoutes(deps: RestRoutesDeps) {
  // Typed with the host's per-request scope: `c.env.cwd` is the project this call belongs to,
  // and it is the ONLY place the collection's location comes from. A route that captured it
  // would serve the first project the process ever saw (see collection/for-scope.ts).
  const app = new Hono<PluginRouteContext>()
  const uid = (c: { env: PluginRouteScope }) => c.env.userId
  const sid = (c: { env?: Partial<PluginRouteScope> }) => c.env?.sessionId
  const resolveCollection = deps.collection ?? collectionFor
  const collection = (c: { env?: Partial<PluginRouteScope> }) =>
    resolveCollection(c.env?.cwd, sid(c))
  // Environments are part of the collection, so they follow the SAME scope. An injected
  // `environments` (tests) wins, exactly as an injected collection does.
  const resolveEnvironments = deps.environments
    ? () => deps.environments!
    : (cwd: string | undefined, sessionId?: string) => environmentsFor(cwd, sessionId)
  const envs = (c: { env?: Partial<PluginRouteScope> }) => resolveEnvironments(c.env?.cwd, sid(c))

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

  const routes = registerEnvironmentRoutes(requestRoutes, { uid, envs })
    /**
     * Import pasted text as previewed — or, with `save: true`, saved — requests.
     *
     * Reuses `runImportAction` for the SIDE EFFECTS (vaulting a pasted literal, saving requests and
     * any environments, and the prose summary the tool prints) and `runImport` + `uniqueNames` for
     * the STRUCTURED response the browser reads. The names are computed against the current store
     * BEFORE the action writes anything, so the read-back after a save resolves the very records
     * that were stored — and every request in the response goes through `toInfo`, redacted.
     */
    .post('/import', validated('json', importSchema), async (c) => {
      const userId = uid(c)
      const { source, save, dir, baseUrl } = c.req.valid('json')
      if (dir !== undefined) {
        return c.json(
          {
            error: 'Directory import is not available from the workbench.',
            code: 'bad_request' as const,
            detail:
              "Reading the repo's exported files needs the plugin's working directory, which the " +
              'agent tool has and these routes do not. Paste the source into "source" instead, or run ' +
              'a directory import through the agent.',
          },
          400,
        )
      }
      const text = source?.trim()
      if (!text) {
        return c.json(
          {
            error: 'Nothing to import.',
            code: 'bad_request' as const,
            detail:
              'Paste a cURL command, an OpenAPI/Swagger spec, a Postman/Insomnia export, or a HAR ' +
              'archive into "source".',
          },
          400,
        )
      }

      const importDeps = {
        store: collection(c),
        userId,
        storeSecret: deps.storeSecret,
        environments: envs(c),
      }
      // Structured parse, and the target names — computed while the store is still untouched, so a
      // later read-back finds the exact ids `runImportAction` will save under.
      const parsed = runImport(text, { baseUrl })
      const named = parsed ? await uniqueNames(collection(c), parsed.requests) : []
      const collisions: string[] = []
      if (parsed) {
        for (const [index, request] of named.entries()) {
          if (request.name !== parsed.requests[index].name) collisions.push(request.name)
        }
      }

      const action = await runImportAction(importDeps, text, save === true, { baseUrl })
      // An unrecognised format (or an OpenAPI-shaped doc describing nothing) comes back here: reuse
      // the action's own crafted problem text rather than restating the list of formats.
      if (!action.ok) {
        return c.json(
          { error: 'Import failed.', code: 'bad_request' as const, detail: action.problem },
          400,
        )
      }
      const requests = await Promise.all(
        named.map(async (n): Promise<RequestInfo> => {
          if (save === true) {
            // Read the ACTUAL stored record — after vaulting it references `${secret:KEY}` rather
            // than the pasted literal, and the response must describe the state on disk.
            const rec = await collection(c).get(n.name)
            // `runImportAction` just saved every named record. Keep a defensive
            // redacted fallback for a custom store with weaker read-after-write.
            // Zero stamps, not `Date.now()`: the record is NOT on disk, so there is no
            // filesystem time to report and inventing one would date a file that never existed.
            return rec
              ? toInfo(rec)
              : { name: n.name, createdAt: 0, updatedAt: 0, spec: redactSpec(n.spec) }
          }
          // A preview was never written; redact the parsed spec so the wire view is still safe.
          return { name: n.name, createdAt: 0, updatedAt: 0, spec: redactSpec(n.spec) }
        }),
      )
      const body: ImportResponse = {
        requests,
        collisions,
        saved: save === true,
        message: action.content,
      }
      return c.json(body)
    })

    .put('/requests/:name', validated('json', updateRequestSchema), async (c) => {
      const name = c.req.param('name')
      const existing = await collection(c).get(name)
      if (!existing) return c.json(REQUEST_NOT_FOUND, 404)

      const edit = c.req.valid('json')
      // A url may hold `{{variables}}`, which are not a url until an environment renders them —
      // the same rule the tool's fix-it guard follows. What must never pass is a non-http literal.
      if (!hasTemplate(edit.url) && !isHttpUrl(edit.url)) {
        return c.json(
          {
            error: `"${edit.url}" is not an http(s) URL.`,
            code: 'bad_request' as const,
            detail:
              'Write the full URL including the scheme, or use a variable like `{{base_url}}/users`.',
          },
          400,
        )
      }

      // A PUT REPLACES. What the payload omits is gone — it is not quietly kept from the stored
      // copy. The spread-when-truthy version of this returned 200, said "saved", and left the old
      // body in place: clearing the body box or deleting every path-param row did nothing, and the
      // next Send transmitted the payload the user believed they had removed.
      //
      // `auth` is the one exception, and it comes from the STORED record precisely because it is
      // NOT in the schema — see updateRequestSchema.
      const hasBody = Boolean(edit.body?.text?.trim() || edit.body?.form?.length)
      const spec: RequestSpec = {
        ...existing.spec,
        url: edit.url,
        method: edit.method,
        headers: edit.headers,
        query: edit.query,
        auth: existing.spec.auth,
      }
      if (edit.pathParameters?.length) spec.pathParameters = edit.pathParameters
      else delete spec.pathParameters
      if (hasBody) spec.body = edit.body
      else delete spec.body
      // Per-request send settings, under the SAME replace rule: an omitted one is cleared, so the
      // request reverts to the plugin default rather than keeping a value the user removed. The
      // spread above copied the stored ones; this is where the PUT's intent overwrites them.
      if (edit.followRedirects !== undefined) spec.followRedirects = edit.followRedirects
      else delete spec.followRedirects
      if (edit.timeoutMs !== undefined) spec.timeoutMs = edit.timeoutMs
      else delete spec.timeoutMs
      if (edit.maxRedirects !== undefined) spec.maxRedirects = edit.maxRedirects
      else delete spec.maxRedirects
      const userId = uid(c)
      const written = await collection(c).save(existing.name, spec)
      if (!written.ok) {
        return c.json({ error: written.problem, code: 'invalid_request' as const }, 422)
      }
      return c.json({
        request: toInfo(written.request),
        resolved: await resolvedFor(envs(c), userId, written.request),
      })
    })

    // Auth has its own route because it needs the keep-the-masked-secret merge (see auth-edit.ts)
    // that the whole-spec PUT above cannot express. A masked field is kept, so the browser saves
    // the block back without ever having seen — or being able to leak — the stored secret.
    .put('/requests/:name/auth', validated('json', z.object({ auth: authSchema })), async (c) => {
      const userId = uid(c)
      const name = c.req.param('name')
      const existing = await collection(c).get(name)
      if (!existing) return c.json(REQUEST_NOT_FOUND, 404)
      const merged = mergeAuth(existing.spec.auth, c.req.valid('json').auth)
      // A LITERAL typed into the auth editor is moved into the vault BEFORE it can reach a file:
      // session JSON is not a credential store, so the store refuses a literal outright. The same
      // `vaultLiteralAuth` the importer uses, so a credential pasted
      // into a cURL command and one typed into the editor take the identical path — create-only,
      // so it can never overwrite a key another integration depends on, and a vault that refuses
      // every candidate name leaves the literal in place for the store to reject with its own
      // (better) message.
      const { auth } = await vaultLiteralAuth(userId, existing.name, merged, deps.storeSecret)
      const spec: RequestSpec = { ...existing.spec, auth }
      const written = await collection(c).save(existing.name, spec)
      if (!written.ok) {
        return c.json({ error: written.problem, code: 'invalid_request' as const }, 422)
      }
      // Tell the vault which keys this request now points at, so deleting one of them warns
      // instead of silently breaking the request. Best-effort by construction — the save above
      // already succeeded and must not be undone by bookkeeping.
      await bindAuthSecrets(userId, existing.name, auth, deps.bindSecret)
      return c.json({
        request: toInfo(written.request),
        resolved: await resolvedFor(envs(c), userId, written.request),
      })
    })

    .delete('/requests/:name', async (c) => {
      const userId = uid(c)
      const name = c.req.param('name')
      const saved = await collection(c).get(name)
      if (!saved) return c.json(REQUEST_NOT_FOUND, 404)
      await collection(c).remove(name)
      dropHistory(userId, name, sid(c))
      return c.json({ ok: true })
    })

    // Rename keeps everything else — createdAt, spec, auth, response history. The name is the
    // identity, so this is remove-then-create under the new id, guarded against collisions.
    .post('/requests/:name/rename', validated('json', z.object({ to: z.string() })), async (c) => {
      const userId = uid(c)
      const from = c.req.param('name')
      const to = c.req.valid('json').to.trim()
      if (to === '') {
        return c.json({ error: 'A name is required.', code: 'bad_request' as const }, 400)
      }
      const saved = await collection(c).get(from)
      if (!saved) return c.json(REQUEST_NOT_FOUND, 404)
      if (to === from) return c.json({ request: toInfo(saved) })
      if (await collection(c).get(to)) {
        return c.json(
          { error: `A request named "${to}" already exists.`, code: 'name_taken' as const },
          409,
        )
      }
      // The MOVE is the store's — a rename here is a file moving between folders, and the
      // write/delete order that keeps it safe is not something each caller should re-derive.
      const renamed = await collection(c).rename(from, to)
      if (!renamed.ok) {
        return c.json({ error: renamed.problem, code: 'invalid_request' as const }, 422)
      }
      renameHistory(userId, from, renamed.request.name, sid(c))
      return c.json({ request: toInfo(renamed.request) })
    })

    // Duplicate under the first free `<name>-copy[-N]` — the whole spec, auth included: the copy
    // is made server-side from the STORED record, so the credential never rode through a browser.
    .post('/requests/:name/duplicate', async (c) => {
      const name = c.req.param('name')
      const saved = await collection(c).get(name)
      if (!saved) return c.json(REQUEST_NOT_FOUND, 404)
      const taken = new Set((await collection(c).list()).map((r) => r.name))
      // The copy lands beside its original, in the same folder — `users/list` duplicates to
      // `users/list-copy`, not to a stray `users/list-copy` at the collection root.
      let copy = `${saved.name}-copy`
      for (let n = 2; taken.has(copy); n++) copy = `${saved.name}-copy-${n}`
      const dup = await collection(c).save(copy, saved.spec)
      if (!dup.ok) return c.json({ error: dup.problem, code: 'invalid_request' as const }, 422)
      return c.json({ request: toInfo(dup.request) }, 201)
    })

    // Recent responses, newest first. In-memory and recent-only by design — see history.ts.
    .get('/requests/:name/history', (c) => {
      return c.json({ entries: listHistory(uid(c), c.req.param('name'), sid(c)) })
    })

    // Clear a request's response history. `dropHistory` empties the ring for this name; the request
    // itself stays. A missing request is a 404, like every other per-request route here.
    .delete('/requests/:name/history', async (c) => {
      const userId = uid(c)
      const name = c.req.param('name')
      if (!(await collection(c).get(name))) {
        return c.json(REQUEST_NOT_FOUND, 404)
      }
      dropHistory(userId, name, sid(c))
      return c.json({ ok: true })
    })

    /**
     * Export a saved request as a shareable command. `?format=curl` (the default and only format).
     *
     * The serializer redacts INTERNALLY (see export/curl.ts): a literal credential is masked, a
     * `${secret:KEY}` reference kept verbatim, and the vault is never read. So this GET carries no
     * secret — which is exactly why it is safe as a plain, preflight-free read.
     */
    .get('/requests/:name/export', async (c) => {
      const saved = await collection(c).get(c.req.param('name'))
      if (!saved) return c.json(REQUEST_NOT_FOUND, 404)
      const format = c.req.query('format') ?? 'curl'
      if (!EXPORT_FORMATS.includes(format as ExportFormat)) {
        return c.json(
          {
            error: `Unknown export format "${format}".`,
            code: 'bad_request' as const,
            detail: `Supported formats: ${EXPORT_FORMATS.join(', ')}.`,
          },
          400,
        )
      }
      return c.text(toCurl(saved.spec), 200, { 'content-type': 'text/plain; charset=utf-8' })
    })

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
        // The request's timeout override wins over the plugin default. Validated positive HERE
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
