/**
 * The settings' answer for an http hook (`allowedHttpHookUrls`, `httpHookAllowedEnvVars`) holds
 * every http hook of the registry: one it refuses is dropped, the rest read only the variables
 * it lists. The answer itself is the kit's (`plugins/kit/settings/hooks.test.ts`).
 */
import { describe, expect, test } from 'bun:test'

import type { CcHookHandler, CcHookRegistry } from './contracts'
import { applyHttpHookPolicy, type HttpHookCheck } from './http-policy'

const http = (httpUrl: string, httpAllowedEnvVars?: string[]): CcHookHandler => ({
  source: 'user',
  command: '',
  kind: 'http',
  httpUrl,
  ...(httpAllowedEnvVars ? { httpAllowedEnvVars } : {}),
  timeoutMs: 1000,
})

const onlyOkDev: HttpHookCheck = (url, vars) =>
  url.startsWith('https://ok.dev/')
    ? { run: true, interpolate: vars.filter((name) => name === 'MY_TOKEN') }
    : { run: false, message: 'blocked' }

describe('applyHttpHookPolicy', () => {
  test('drops an http hook the policy refuses, and leaves the rest', () => {
    const command: CcHookHandler = { source: 'user', command: 'echo', timeoutMs: 1000 }
    const registry: CcHookRegistry = {
      PostToolUse: [
        { handlers: [http('https://evil.example.org/'), http('https://ok.dev/'), command] },
      ],
    }
    applyHttpHookPolicy(registry, onlyOkDev)
    expect(registry.PostToolUse?.[0]?.handlers.map((h) => h.httpUrl ?? h.command)).toEqual([
      'https://ok.dev/',
      'echo',
    ])
  })

  test('a hook reads only the variables the policy lists', () => {
    const registry: CcHookRegistry = {
      Stop: [{ handlers: [http('https://ok.dev/', ['MY_TOKEN', 'AWS_SECRET'])] }],
    }
    applyHttpHookPolicy(registry, onlyOkDev)
    expect(registry.Stop?.[0]?.handlers[0]?.httpAllowedEnvVars).toEqual(['MY_TOKEN'])
  })
})
