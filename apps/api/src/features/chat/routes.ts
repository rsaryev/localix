import { Hono } from 'hono'
import type { AppContext } from '../../app'
import { defaultErrorHandler } from '../../lib/http'
import type { ChatRoutesService } from './routes-types'
import { createChatSessionsRoutes } from './routes-sessions'
import { createChatSkillsRoutes } from './routes-skills'
import { createChatFilesRoutes } from './routes-files'
import { createChatMessagesRoutes } from './routes-messages'
import { createChatUsageRoutes } from './routes-usage'
import { createChatRecapRoutes } from './routes-recap'
export type { ChatRoutesService } from './routes-types'

/**
 * Chat RPC surface. Handlers are grouped by concern in `routes-*.ts`; request schemas
 * live in `contracts.ts` (shared) and `routes-schemas.ts` (route-local). Mounting at
 * `/` keeps every path and the chained RPC types unchanged.
 */
export function createChatRoutes(service: ChatRoutesService) {
  const routes = new Hono<AppContext>()
    .route('/', createChatSessionsRoutes(service))
    .route('/', createChatSkillsRoutes(service))
    .route('/', createChatFilesRoutes(service))
    .route('/', createChatMessagesRoutes(service))
    .route('/', createChatUsageRoutes(service))
    .route('/', createChatRecapRoutes(service))

  routes.onError(defaultErrorHandler)

  return routes
}
