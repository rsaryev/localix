import { describe, expect, test } from 'bun:test'
import type { SendResponse } from '../../backend/contracts'
import { buildResponseContext } from './responseMessageContext'

/** A minimal SendResponse — only the fields the context builder reads matter. */
function res(over: Partial<SendResponse>): SendResponse {
  return {
    status: 200,
    statusText: 'OK',
    url: 'https://example.test/',
    headers: {},
    body: '',
    bytes: 0,
    truncated: false,
    elapsedMs: 12,
    hops: [{ url: 'https://example.test/', status: 200, elapsedMs: 1 }],
    ...over,
  }
}

describe('buildResponseContext', () => {
  test('snippet carries the status line AND the body', () => {
    const { snippet } = buildResponseContext({
      response: res({
        status: 404,
        statusText: 'Not Found',
        headers: { 'content-type': 'application/json' },
        body: '{"error":"missing"}',
      }),
    })
    expect(snippet).toContain('HTTP 404 Not Found')
    expect(snippet).toContain('URL: https://example.test/')
    expect(snippet).toContain('Body:\n{\n  error: "missing"\n}')
    expect(snippet).not.toContain('```')
  })

  test('the host fence is HTTP for every response envelope', () => {
    const lang = (contentType: string | undefined) =>
      buildResponseContext({
        response: res({ headers: contentType ? { 'content-type': contentType } : {} }),
      }).language
    expect(lang('application/json')).toBe('http')
    expect(lang('application/xml')).toBe('http')
    expect(lang('text/plain')).toBe('http')
    expect(lang(undefined)).toBe('http')
  })

  test('XML remains readable inside the HTTP envelope', () => {
    const { snippet } = buildResponseContext({
      response: res({ headers: { 'content-type': 'application/xml' }, body: '<a/>' }),
    })
    expect(snippet).toContain('Content-Type: application/xml')
    expect(snippet).toContain('Body:\n<a/>')
  })

  test('an empty body is explicit', () => {
    const { snippet } = buildResponseContext({
      response: res({ status: 204, statusText: 'No Content', body: '' }),
    })
    expect(snippet).toContain('HTTP 204 No Content')
    expect(snippet).toContain('Body:\n(empty)')
    expect(snippet).not.toContain('```')
  })

  test('an ordinary JSON body field no longer creates a denied context shape', () => {
    const { snippet } = buildResponseContext({
      response: res({
        headers: { 'content-type': 'application/json' },
        body: '{"body":"Sample response","token":"should-not-reach-context"}',
      }),
    })
    expect(snippet).toContain('body: "Sample response"')
    expect(snippet).toContain('token: "[redacted]"')
    expect(snippet).not.toContain('"body":')
    expect(snippet).not.toContain('should-not-reach-context')
  })
})
