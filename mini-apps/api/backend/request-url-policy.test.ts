import { describe, expect, test } from 'bun:test'
import { isHttpUrl, urlProblem } from './request-spec'

describe('URL policy boundaries', () => {
  test('trims diagnostics without guessing a scheme for IPv6 hosts', () => {
    const raw = '  [::1]:3000/api  '
    const problem = urlProblem(raw)
    expect(problem?.code).toBe('bad_request')
    expect(problem?.message).toContain('"[::1]:3000/api" has no scheme')
    expect(problem?.message).toContain('"https://[::1]:3000/api"')
    expect(raw).toBe('  [::1]:3000/api  ')
  })

  test.each([' HTTP://api.dev/x ', 'https://[::1]:3000/api', 'https://api.dev/:id'])(
    'accepts %s without changing the URL',
    (raw) => {
      expect(isHttpUrl(raw)).toBe(true)
      expect(urlProblem(raw)).toBeNull()
    },
  )

  test.each([' FILE:/etc/passwd ', 'data:text/plain,hello', 'custom:payload'])(
    'classifies the valid non-HTTP URL %s as blocked',
    (raw) => {
      expect(isHttpUrl(raw)).toBe(false)
      expect(urlProblem(raw)?.code).toBe('blocked')
    },
  )

  test('reports an unparseable HTTP URL as bad input rather than a blocked scheme', () => {
    expect(isHttpUrl('https://')).toBe(false)
    expect(urlProblem('https://')?.code).toBe('bad_request')
  })
})
