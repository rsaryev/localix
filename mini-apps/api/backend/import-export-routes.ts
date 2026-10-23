import type { Hono, Schema } from 'hono'
import { z } from 'zod'
import type { MiniAppRouteContext } from '@localixai/mini-app-sdk/backend'
import type { RestRoutesDeps } from './routes'
import type { RestRouteScope } from './route-scope'
import type { ExportFormat, ImportResponse, RequestInfo } from './contracts'
import { EXPORT_FORMATS } from './contracts'
import { runImportAction, uniqueNames } from './import-action'
import { runImport } from './import/registry'
import { redactSpec } from './store'
import { toCurl } from './export/curl'
import { validated } from './route-validation'
import { REQUEST_NOT_FOUND, toInfo } from './request-route-values'

type CollectionRouteDeps = Pick<RestRouteScope, 'collection'>
interface ImportRouteDeps extends Pick<RestRouteScope, 'collection' | 'uid' | 'envs'> {
  deps: Pick<RestRoutesDeps, 'storeSecret'>
}

/**
 * The workbench import payload. `source` is pasted text (a cURL command, an OpenAPI/Swagger spec, a
 * Postman/Insomnia export, a HAR). `save` writes them; absent/false is a preview. `dir` is accepted
 * for wire-parity with the agent tool but refused here — reading repo files needs the mini app's
 * working directory, which the tool has and these routes do not.
 */
const importSchema = z.object({
  source: z.string().optional(),
  save: z.boolean().optional(),
  dir: z.string().optional(),
  baseUrl: z.string().optional(),
})

export function registerImportRoute<TSchema extends Schema>(
  app: Hono<MiniAppRouteContext, TSchema>,
  { uid, collection, envs, deps }: ImportRouteDeps,
) {
  return (
    app
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
                "Reading the repo's exported files needs the mini app's working directory, which the " +
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
            { error: 'Import failed.', code: 'bad_request' as const, detail: action.message },
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
          message: action.message,
        }
        return c.json(body)
      })
  )
}

export function registerRequestExportRoute<TSchema extends Schema>(
  app: Hono<MiniAppRouteContext, TSchema>,
  { collection }: CollectionRouteDeps,
) {
  return (
    app
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
  )
}
