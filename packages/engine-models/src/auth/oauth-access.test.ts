import { afterEach, describe, expect, test } from 'bun:test'

import type {
  RuntimeCredential,
  RuntimeCredentialStore,
  RuntimeOAuthCredential,
} from '@localixai/agent/runtime'

import type { CatalogEntry } from '../catalog/catalog'
import { accessFor } from './auth'
import { openAICodexFlow } from './flows/openai-codex'
import type { OAuthFlow } from './flows/types'
import { freshOAuth, refreshingAccess } from './oauth-access'

const oauth = (token: string, lifetimeMs = 30 * 60_000): RuntimeOAuthCredential => ({
  type: 'oauth',
  accessToken: token,
  refreshToken: `r-${token}`,
  expiresAt: Date.now() + lifetimeMs,
})

/** A provider whose every refresh hands out the next token, recording the signal it got. */
function flowWith(next: () => string, fetch?: typeof globalThis.fetch) {
  const signals: AbortSignal[] = []
  const flow: OAuthFlow = {
    login: async () => oauth('login'),
    refresh: async (_credential, signal) => {
      signals.push(signal)
      return oauth(next())
    },
    access: (credential) => ({ apiKey: credential.accessToken, ...(fetch ? { fetch } : {}) }),
  }
  return { flow, signals }
}

/** A provider endpoint that accepts only `accepted` tokens, recording what each request sent. */
function endpoint(accepted: (token: string) => boolean) {
  const sent: string[] = []
  const fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const token = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? ''
    sent.push(token)
    return new Response(accepted(token) ? '{}' : '{"error":"expired"}', {
      status: accepted(token) ? 200 : 401,
    })
  }) as unknown as typeof globalThis.fetch
  return { fetch, sent }
}

function memoryStore(initial: RuntimeCredential): RuntimeCredentialStore {
  let current: RuntimeCredential | undefined = initial
  let lock = Promise.resolve()
  return {
    read: async () => current,
    list: async () => [],
    modify: async (_id, update) => {
      const run = lock.then(async () => {
        const next = await update(current)
        if (next) current = next
        return next
      })
      lock = run.then(() => undefined)
      return run
    },
    delete: async () => {
      current = undefined
    },
  }
}

/** A request as the SDK sends it: with the token the model was built with. */
const request = (access: { fetch?: typeof globalThis.fetch }, token: string) =>
  access.fetch!('https://provider.test/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: '{}',
  })

describe('an OAuth credential kept fresh for the whole run', () => {
  test('a token that lapses partway through a run is refreshed before the next request', async () => {
    const { fetch, sent } = endpoint(() => true)
    const { flow } = flowWith(() => 'T2', fetch)
    // Fresh when the run binds its model, inside the refresh margin a moment later.
    const access = refreshingAccess('copilot', oauth('T1', 60_300), flow, undefined, {})
    await request(access, 'T1')
    await Bun.sleep(400)
    await request(access, 'T1')
    expect(sent).toEqual(['T1', 'T2'])
  })

  test('a request refused with 401 refreshes the token once and is sent again', async () => {
    const { fetch, sent } = endpoint((token) => token === 'T2')
    let refreshes = 0
    const { flow } = flowWith(() => `T${++refreshes + 1}`, fetch)
    const access = refreshingAccess('copilot', oauth('T1'), flow, undefined, {})
    expect((await request(access, 'T1')).status).toBe(200)
    expect(sent).toEqual(['T1', 'T2'])
    expect(refreshes).toBe(1)
    // A token the provider keeps refusing is not refreshed in a loop.
    const refusing = endpoint(() => false)
    const stubborn = refreshingAccess(
      'copilot',
      oauth('T1'),
      flowWith(() => 'T9', refusing.fetch).flow,
      undefined,
      {},
    )
    expect((await request(stubborn, 'T1')).status).toBe(401)
    expect(refusing.sent).toEqual(['T1', 'T9'])
  })

  test('after a 401, a token another run already refreshed is used without refreshing again', async () => {
    const { fetch, sent } = endpoint((token) => token === 'T2')
    const store = memoryStore(oauth('T1'))
    const { flow, signals } = flowWith(() => 'never', fetch)
    const access = refreshingAccess('copilot', oauth('T1'), flow, store, {})
    await store.modify('copilot', async () => oauth('T2'))
    expect((await request(access, 'T1')).status).toBe(200)
    expect(sent).toEqual(['T1', 'T2'])
    expect(signals).toHaveLength(0)
  })

  test('a refresh runs on its own deadline: a stopped run cannot lose a rotated refresh token', async () => {
    const { flow, signals } = flowWith(() => 'T2')
    const refreshed = await freshOAuth('copilot', oauth('T1', 0), flow, memoryStore(oauth('T1', 0)))
    expect(refreshed.accessToken).toBe('T2')
    expect(signals[0]?.aborted).toBe(false)
  })
})

describe('the ChatGPT (Codex) refresh', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  /** A JWT whose payload needs base64url (`-`, `_`) and names the account. */
  const jwt = (accountId: string) =>
    `x.${Buffer.from(
      JSON.stringify({
        'https://api.openai.com/auth': { chatgpt_account_id: accountId },
        n: '>?~ü',
      }),
    ).toString('base64url')}.y`

  test('keeps the old refresh token and an hour of life when the answer leaves them out, even after a stop', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ access_token: jwt('acct-1') }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof globalThis.fetch
    const entry = { provider: { id: 'openai-codex', name: 'Codex', local: false } } as CatalogEntry
    const stopped = new AbortController()
    stopped.abort()
    const { access } = await accessFor(entry, oauth('old', 0), { signal: stopped.signal })
    expect(access.apiKey).toBe(jwt('acct-1'))
    expect(access.headers?.['chatgpt-account-id']).toBe('acct-1')

    const refreshed = await openAICodexFlow.refresh(oauth('old', 0), new AbortController().signal)
    expect(refreshed.refreshToken).toBe('r-old')
    expect(refreshed.expiresAt - Date.now()).toBeGreaterThan(3_590_000)
    expect(refreshed.extra?.accountId).toBe('acct-1')
  })
})
