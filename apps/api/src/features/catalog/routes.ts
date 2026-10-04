import { createHash } from 'node:crypto'
import { Hono } from 'hono'

import type { AppContext } from '../../app'
import { defaultErrorHandler } from '../../lib/http'
import { catalogResponseSchema, type CatalogResponse } from './contracts'

export interface CatalogRoutesService {
  getCatalog(): Promise<CatalogResponse>
}

/** One validated, serialized body per catalog BUILD, and the validator that names it. */
interface CatalogWire {
  body: string
  etag: string
}

/**
 * The catalog on the wire, computed once per build instead of once per request.
 *
 * The catalog is ~700 KB and 1,500 models, and it changes only when the adapter's metadata does.
 * Every request used to zod-parse and re-serialize it, and to send all of it to a client that
 * already had it. The service hands back the SAME object for as long as its build stands, so a
 * WeakMap keyed on that object computes the parse, the body and its hash once, and a revalidating
 * client (`If-None-Match`) gets a 304 with no body. The parse is kept, just not repeated: it is
 * what strips the in-process fields (a provider's env-var names) from the response.
 */
const wireByCatalog = new WeakMap<CatalogResponse, CatalogWire>()

function wireFor(catalog: CatalogResponse): CatalogWire {
  let wire = wireByCatalog.get(catalog)
  if (!wire) {
    const body = JSON.stringify(catalogResponseSchema.parse(catalog))
    wire = { body, etag: `"${createHash('sha1').update(body).digest('base64url')}"` }
    wireByCatalog.set(catalog, wire)
  }
  return wire
}

/** RFC 9110 weak comparison: `*`, or any listed tag equal once a `W/` prefix is dropped. */
function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false
  if (header.trim() === '*') return true
  return header.split(',').some((tag) => tag.trim().replace(/^W\//u, '') === etag)
}

export function createCatalogRoutes(service: CatalogRoutesService) {
  const app = new Hono<AppContext>()

  const routes = app.get('/', async (c) => {
    const { body, etag } = wireFor(await service.getCatalog())
    // `no-cache` = store it, but revalidate before every use: the browser then sends the tag back
    // on its own, and a new build (a new tag) is never masked by a stale copy.
    c.header('ETag', etag)
    c.header('Cache-Control', 'no-cache')
    if (matchesEtag(c.req.header('If-None-Match'), etag)) return c.body(null, 304)
    return c.body(body, 200, { 'Content-Type': 'application/json; charset=UTF-8' })
  })

  routes.onError(defaultErrorHandler)

  return routes
}
