import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ApiError, defaultErrorHandler, isApiError } from '@localixai/mini-app-sdk/backend'
import {
  ConflictError,
  ForbiddenError,
  InternalError,
  InvalidRequestError,
  NotFoundError,
  UnavailableError,
  UnprocessableError,
} from './domain-errors'
import { createRootErrorHandler } from './http'
import type { Logger } from './logger'

const cases = [
  [InvalidRequestError, 400],
  [ForbiddenError, 403],
  [NotFoundError, 404],
  [ConflictError, 409],
  [UnprocessableError, 422],
  [InternalError, 500],
  [UnavailableError, 503],
] as const

const silent = { error: () => {} } as unknown as Logger

async function answer(error: Error, handler: 'root' | 'default') {
  const app = new Hono()
  app.get('/', () => {
    throw error
  })
  app.onError(handler === 'root' ? createRootErrorHandler(silent) : defaultErrorHandler)
  const response = await app.request('/')
  return { status: response.status, body: await response.json() }
}

describe('domain errors answer exactly as the ApiError they replace', () => {
  for (const [DomainClass, status] of cases) {
    test(`${DomainClass.name} → ${status}`, async () => {
      const domain = new DomainClass('some_code', 'Something happened', 'raw detail')
      const legacy = new ApiError(status, 'some_code', 'Something happened', 'raw detail')
      expect(isApiError(domain)).toBe(true)
      expect(domain.name).toBe('ApiError')
      for (const handler of ['root', 'default'] as const) {
        const [got, want] = await Promise.all([answer(domain, handler), answer(legacy, handler)])
        expect(got).toEqual(want)
        expect(got.status).toBe(status)
      }
    })
  }

  test('an error without detail carries no detail field', async () => {
    const { body } = await answer(new NotFoundError('session_not_found', 'Not found'), 'root')
    expect(body).toEqual({ error: { code: 'session_not_found', message: 'Not found' } })
  })
})
