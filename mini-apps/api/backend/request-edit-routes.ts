import type { Hono, Schema } from 'hono'
import { z } from 'zod'
import type { MiniAppRouteContext } from '@localixai/mini-app-sdk/backend'
import type { RestRoutesDeps } from './routes'
import type { RestRouteScope } from './route-scope'
import { HTTP_METHODS, isHttpUrl, type RequestSpec } from './request-spec'
import { hasTemplate } from './template'
import { mergeAuth } from './auth-edit'
import { vaultLiteralAuth } from './vault-auth'
import { bindAuthSecrets } from './vault-bindings'
import { validated, pairSchema, bodySchema } from './route-validation'
import { REQUEST_NOT_FOUND, toInfo, resolvedFor } from './request-route-values'

interface RequestEditRouteDeps extends Pick<RestRouteScope, 'uid' | 'collection' | 'envs'> {
  deps: Pick<RestRoutesDeps, 'storeSecret' | 'bindSecret'>
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
 * close — the same origin already has `mini-apps/database`'s `/:id/query`, i.e. arbitrary SQL, under
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

/** Register whole-request replacement and credential-preserving auth editing in order. */
export function registerRequestEditRoutes<TSchema extends Schema>(
  app: Hono<MiniAppRouteContext, TSchema>,
  { uid, collection, envs, deps }: RequestEditRouteDeps,
) {
  return (
    app
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
        // request reverts to the mini app default rather than keeping a value the user removed. The
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
  )
}
