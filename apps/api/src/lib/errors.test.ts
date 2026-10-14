import { describe, expect, test } from 'bun:test'
import { ApiError, isApiError } from './errors'

describe('ApiError', () => {
  test('carries status + code + message and is a real Error', () => {
    const e = new ApiError(404, 'not_found', 'no such session')
    expect(e.status).toBe(404)
    expect(e.code).toBe('not_found')
    expect(e.message).toBe('no such session')
    expect(e.name).toBe('ApiError')
    expect(e).toBeInstanceOf(Error)
  })
})

describe('isApiError', () => {
  test('true only for ApiError instances', () => {
    expect(isApiError(new ApiError(500, 'oops', 'x'))).toBe(true)
  })
  test('false for plain errors and non-errors', () => {
    expect(isApiError(new Error('plain'))).toBe(false)
    expect(isApiError({ status: 404, code: 'not_found' })).toBe(false) // shape-alike, not an instance
    expect(isApiError(null)).toBe(false)
    expect(isApiError('not_found')).toBe(false)
    expect(isApiError(undefined)).toBe(false)
  })
})
