import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'
import type { AppContext } from '../../app'
import { sessionParamsSchema } from './contracts'
import type { ChatRoutesService } from './routes-types'

/**
 * The window asks for the automatic recap once it has seen the person leave for a while. The
 * server decides whether one is due (turns, the break, never twice in a row, the switch on the
 * model picker row) and answers what it did; the recap itself arrives as a transcript row.
 */
export function createChatRecapRoutes(service: ChatRoutesService) {
  return new Hono<AppContext>().post(
    '/sessions/:id/recap',
    zValidator('param', sessionParamsSchema),
    async (c) =>
      c.json(await service.requestSessionRecap(c.get('userId'), c.req.valid('param').id), 200),
  )
}
