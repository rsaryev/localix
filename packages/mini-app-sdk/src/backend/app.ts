import { Hono, type Context } from 'hono'
import type { z } from 'zod'
import type { AgentTool } from '@localixai/agent/agents'
import { openCollection, type Collection, type CollectionSpec } from './collection'
import type { MiniAppContext } from './context'
import { jsonBody, jsonError, type MiniAppRouteContext } from './http'
import { createJsonStoreFeed } from './json-store'
import type { MiniAppRegistration } from './registration'
import type { BackendSubsystem } from './subsystem'

/**
 * A mini app's backend from its collections and tools: `createMiniApp(ctx)` builds what every mini
 * app needs around them — the routes under `/rpc/<app>`, the store feed that nudges an open view
 * after any write, and the registration the host reads.
 *
 * ```ts
 * export function register(ctx: MiniAppContext) {
 *   const app = createMiniApp(ctx)
 *   const meals = app.collection(mealsSpec)
 *   return app.registration({ tools: [logMeal(ctx, meals)] })
 * }
 * ```
 */
export interface MiniApp {
  /** The router's mount path, `/rpc/<mini app name>`. */
  readonly route: string
  /** Open a collection: its store, operations, routes and index join this mini app. */
  collection<T extends { id: string }, S extends z.ZodRawShape>(
    spec: CollectionSpec<T, S>,
  ): Collection<T, S>
  /**
   * What `register(ctx)` returns. `routes` adds the app's own routes beside the collections'
   * (mounted at the same path); `backend` adds fields of the backend subsystem, such as
   * `resourceProvider` or `contextProviders`.
   */
  registration(parts?: {
    tools?: AgentTool[]
    routes?: Hono<MiniAppRouteContext>
    backend?: Omit<BackendSubsystem, 'id' | 'routeMount'>
  }): MiniAppRegistration & { tools: AgentTool[]; backend: BackendSubsystem[] }
}

type AnyCollection = Collection<{ id: string }, z.ZodRawShape>

export function createMiniApp(ctx: MiniAppContext): MiniApp {
  const collections: AnyCollection[] = []
  const route = `/rpc/${ctx.miniAppName}`
  return {
    route,
    collection(spec) {
      const collection = openCollection(ctx, spec)
      collections.push(collection as unknown as AnyCollection)
      return collection
    },
    registration(parts = {}) {
      const scoped = (scope: 'app' | 'chat') =>
        collections.some((c) => (c.spec.scope ?? 'app') === scope)
      // One feed for every collection: a write under the app's folder, or a chat's, nudges the
      // views open on that scope. The views re-read; a frame never carries the state (P11).
      const feed = createJsonStoreFeed({
        miniApp: ctx.miniAppName,
        watchPath: ctx.watchPath ?? ctx.host?.watchPath,
        resolveDir: async (userId, sessionId) => {
          if (sessionId === null) return scoped('app') ? ctx.dataDir : null
          if (!scoped('chat') || !ctx.sessionStorage) return null
          return ctx.sessionStorage.resolveDataDir(userId, sessionId)
        },
      })
      const app = new Hono<MiniAppRouteContext>()
      for (const collection of collections) mountCollection(app, collection)
      if (parts.routes) app.route('/', parts.routes)
      const backend: BackendSubsystem = {
        ...parts.backend,
        id: `${ctx.miniAppName}:backend`,
        routeMount: { path: route, app },
        wsFrames: [...(parts.backend?.wsFrames ?? []), ...feed.wsFrames],
        onShutdown: async () => {
          feed.onShutdown()
          await parts.backend?.onShutdown?.()
        },
      }
      return { tools: parts.tools ?? [], backend: [backend] }
    },
  }
}

/**
 * The four routes of one collection. Each change answers with the whole new list, so the view
 * replaces what it shows with the answer and never keeps a second copy to reconcile.
 */
function mountCollection(app: Hono<MiniAppRouteContext>, collection: AnyCollection): void {
  const { name, input } = collection.spec
  const chat = collection.spec.scope === 'chat'
  const where = (c: Context<MiniAppRouteContext>) => ({
    userId: c.env.userId,
    sessionId: c.env.sessionId ?? null,
  })
  const listed = async (c: Context<MiniAppRouteContext>) => {
    c.header('Cache-Control', 'no-store')
    return c.json({ items: await collection.list(where(c)) })
  }
  const needsChat = (c: Context<MiniAppRouteContext>) =>
    chat && !c.env.sessionId
      ? jsonError(c, 400, 'chat_required', 'Open this in a chat.')
      : undefined
  const gone = (c: Context<MiniAppRouteContext>) =>
    jsonError(c, 404, 'not_found', 'That item is gone.')

  app
    .get(`/${name}`, async (c) => needsChat(c) ?? listed(c))
    .post(`/${name}`, jsonBody(input), async (c) => {
      const refused = needsChat(c)
      if (refused) return refused
      await collection.add(c.req.valid('json'), where(c))
      return listed(c)
    })
    .patch(`/${name}/:id`, jsonBody(input.partial()), async (c) => {
      const refused = needsChat(c)
      if (refused) return refused
      const changed = await collection.update(c.req.param('id'), c.req.valid('json'), where(c))
      return changed ? listed(c) : gone(c)
    })
    .delete(`/${name}/:id`, async (c) => {
      const refused = needsChat(c)
      if (refused) return refused
      return (await collection.remove(c.req.param('id'), where(c))) ? listed(c) : gone(c)
    })
}
