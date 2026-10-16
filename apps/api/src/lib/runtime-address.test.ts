import { describe, it, expect } from 'bun:test'
import { loadEnv } from './env'
import {
  dialableRuntimeBaseUrl,
  resolveRuntimeAddress,
  resolveWebhookUrl,
  runtimeBaseUrlMatchesHost,
  WEBHOOK_MESSAGES_PATH,
} from './runtime-address'

const env = (over: Record<string, string | undefined>) => loadEnv({ ...over })

describe('resolveRuntimeAddress', () => {
  it('matches the exact host a port-only client will dial', () => {
    expect(runtimeBaseUrlMatchesHost('http://127.0.0.1:5051', '127.0.0.1')).toBe(true)
    expect(runtimeBaseUrlMatchesHost('http://[::1]:5051', '127.0.0.1')).toBe(false)
    expect(runtimeBaseUrlMatchesHost('http://localhost:5051', '127.0.0.1')).toBe(false)
    expect(runtimeBaseUrlMatchesHost('not a URL', '127.0.0.1')).toBe(false)
  })

  it('uses HOST/PORT verbatim for a concrete bind', () => {
    const a = resolveRuntimeAddress(env({ HOST: '192.168.1.5', PORT: '8080' }))
    expect(a).toEqual({ host: '192.168.1.5', port: 8080, baseUrl: 'http://192.168.1.5:8080' })
  })

  it('normalizes a wildcard IPv4 bind (0.0.0.0) to loopback', () => {
    expect(resolveRuntimeAddress(env({ HOST: '0.0.0.0', PORT: '5051' })).host).toBe('127.0.0.1')
  })

  it('normalizes a wildcard IPv6 bind (::) to loopback', () => {
    expect(resolveRuntimeAddress(env({ HOST: '::', PORT: '5051' })).host).toBe('127.0.0.1')
    expect(resolveRuntimeAddress(env({ HOST: '[::]', PORT: '5051' })).host).toBe('127.0.0.1')
  })

  it('formats concrete IPv6 origins with brackets', () => {
    expect(dialableRuntimeBaseUrl('::1', 5051)).toBe('http://[::1]:5051')
    expect(dialableRuntimeBaseUrl('[::1]', 5051)).toBe('http://[::1]:5051')
    expect(resolveWebhookUrl(env({ HOST: '::1', PORT: '5051' }))).toBe(
      `http://[::1]:5051${WEBHOOK_MESSAGES_PATH}`,
    )
  })

  it('falls back to env defaults when unset', () => {
    const a = resolveRuntimeAddress(env({ HOST: undefined, PORT: undefined }))
    expect(a).toEqual({ host: '127.0.0.1', port: 5051, baseUrl: 'http://127.0.0.1:5051' })
  })
})

describe('resolveWebhookUrl', () => {
  it('appends the single-source webhook route path to the base URL', () => {
    expect(resolveWebhookUrl(env({ HOST: '0.0.0.0', PORT: '9000' }))).toBe(
      `http://127.0.0.1:9000${WEBHOOK_MESSAGES_PATH}`,
    )
    expect(WEBHOOK_MESSAGES_PATH).toBe('/rpc/webhook/messages')
  })
})
