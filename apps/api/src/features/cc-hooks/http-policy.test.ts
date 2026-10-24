/**
 * Claude Code's `allowedHttpHookUrls` and `httpHookAllowedEnvVars` (settings-reference.md): an
 * http hook runs only when its URL matches the merged allowlist, and its headers read only the
 * variables both it and the settings list.
 */
import { describe, expect, test } from 'bun:test'

import type { CcHookHandler, CcHookRegistry } from './contracts'
import { applyHttpHookPolicy, httpUrlAllowed } from './http-policy'

const http = (httpUrl: string, httpAllowedEnvVars?: string[]): CcHookHandler => ({
  source: 'user',
  command: '',
  kind: 'http',
  httpUrl,
  ...(httpAllowedEnvVars ? { httpAllowedEnvVars } : {}),
  timeoutMs: 1000,
})

describe('allowedHttpHookUrls', () => {
  test('matches with * wildcards, the host case-insensitively and without its trailing dot', () => {
    const allow = ['https://hooks.example.com/*', 'http://localhost:*']
    expect(httpUrlAllowed('https://hooks.example.com/a/b', allow)).toBe(true)
    expect(httpUrlAllowed('https://HOOKS.Example.com./x', allow)).toBe(true)
    expect(httpUrlAllowed('http://localhost:8080/hook', allow)).toBe(true)
    expect(httpUrlAllowed('https://evil.example.org/', allow)).toBe(false)
    expect(httpUrlAllowed('https://hooks.example.com/x', [])).toBe(false)
  })

  test('drops an http hook whose URL is not allowed, and leaves the rest', () => {
    const command: CcHookHandler = { source: 'user', command: 'echo', timeoutMs: 1000 }
    const registry: CcHookRegistry = {
      PostToolUse: [
        { handlers: [http('https://evil.example.org/'), http('https://ok.dev/'), command] },
      ],
    }
    applyHttpHookPolicy(registry, { allowedUrls: ['https://ok.dev/*'] })
    expect(registry.PostToolUse?.[0]?.handlers.map((h) => h.httpUrl ?? h.command)).toEqual([
      'https://ok.dev/',
      'echo',
    ])
  })

  test('unset, every URL runs', () => {
    const registry: CcHookRegistry = { Stop: [{ handlers: [http('https://any.where/')] }] }
    applyHttpHookPolicy(registry, {})
    expect(registry.Stop?.[0]?.handlers).toHaveLength(1)
  })
})

describe('httpHookAllowedEnvVars', () => {
  test('a hook reads only the variables both it and the settings name', () => {
    const registry: CcHookRegistry = {
      Stop: [{ handlers: [http('https://ok.dev/', ['MY_TOKEN', 'AWS_SECRET'])] }],
    }
    applyHttpHookPolicy(registry, { allowedEnvVars: ['MY_TOKEN', 'HOOK_SECRET'] })
    expect(registry.Stop?.[0]?.handlers[0]?.httpAllowedEnvVars).toEqual(['MY_TOKEN'])
  })
})
