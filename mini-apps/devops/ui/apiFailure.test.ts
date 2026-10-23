import { describe, expect, test } from 'bun:test'
import { hasApiFailure, parseApiFailure } from './apiFailure'

describe('DevOps API failure parsing', () => {
  test('preserves the typed mini app error envelope', () => {
    expect(
      parseApiFailure(
        {
          error: 'Docker is unavailable',
          code: 'engine_unavailable',
          detail: 'Start Docker Desktop',
        },
        503,
      ),
    ).toEqual({
      message: 'Docker is unavailable',
      code: 'engine_unavailable',
      detail: 'Start Docker Desktop',
    })
  })

  test('unwraps the host error envelope instead of rendering object Object', () => {
    const body = { error: { code: 'not_found', message: 'Route not found' } }
    expect(hasApiFailure(body)).toBe(true)
    expect(parseApiFailure(body, 404)).toEqual({
      message: 'Route not found',
      code: 'not_found',
    })
  })

  test('uses a bounded status fallback for malformed object bodies', () => {
    expect(parseApiFailure({ error: { unexpected: true } }, 502)).toEqual({
      message: 'Request failed (502)',
    })
    expect(parseApiFailure(null, 500).message).not.toContain('[object Object]')
  })
})
