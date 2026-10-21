import { afterEach, describe, expect, test } from 'bun:test'

import type { CatalogEntry } from '../catalog/catalog'
import type { Route } from '../catalog/families'
import { decisionModelFor, languageModelFor } from './connect'

/**
 * The server's environment holds the user's dotfile exports (the login shell is folded in at
 * boot), so `OPENAI_BASE_URL` may name a proxy and `OPENAI_API_KEY` another account's key. A
 * connection's requests must go where the catalog says, with the connection's key or none.
 */
const VARIABLES = {
  OPENAI_BASE_URL: 'https://attacker.test/v1',
  OPENAI_API_KEY: 'SERVER-OPENAI',
  ANTHROPIC_BASE_URL: 'https://attacker.test',
  ANTHROPIC_API_KEY: 'SERVER-ANTHROPIC',
  GOOGLE_GENERATIVE_AI_API_KEY: 'SERVER-GOOGLE',
  OPENROUTER_API_KEY: 'SERVER-OPENROUTER',
  AI_GATEWAY_API_KEY: 'SERVER-GATEWAY',
}
const saved = Object.fromEntries(Object.keys(VARIABLES).map((name) => [name, process.env[name]]))
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

function entry(providerId: string, route: Route, kind: 'chat' | 'decision' = 'chat'): CatalogEntry {
  return {
    provider: { id: providerId, name: providerId, local: false },
    route,
    model: {
      id: 'm',
      name: 'm',
      route,
      input: ['text'],
      output: ['text'],
      attachment: false,
      tools: true,
      reasons: false,
      reasoning: [],
      temperature: true,
      kind,
      api: 'x',
    },
  }
}

function capture() {
  const requests: Array<{ url: string; headers: Headers }> = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: input instanceof Request ? input.url : input.toString(),
      headers: new Headers(init?.headers),
    })
    return new Response('{"error":{"message":"stop here"}}', {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof globalThis.fetch
  return { fetch, requests }
}

const send = async (model: Awaited<ReturnType<typeof languageModelFor>>) =>
  Promise.resolve(
    model.doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }),
  ).catch(() => undefined)

/** Every header value of the request, to search for a server-side secret. */
const values = (headers: Headers) => [...headers.values()].join(' ')

describe("a connection never borrows the server's environment", () => {
  const cases: Array<[string, Route, string, string]> = [
    ['openai', { family: 'openai' }, 'https://api.openai.com/v1/', 'authorization'],
    ['anthropic', { family: 'anthropic' }, 'https://api.anthropic.com/v1/', 'x-api-key'],
    [
      'google',
      { family: 'google' },
      'https://generativelanguage.googleapis.com/v1beta/',
      'x-goog-api-key',
    ],
    ['openrouter', { family: 'openrouter' }, 'https://openrouter.ai/api/v1/', 'authorization'],
  ]

  for (const [providerId, route, address, header] of cases) {
    test(`${providerId}: its own address and key, whatever the environment names`, async () => {
      Object.assign(process.env, VARIABLES)
      const { fetch, requests } = capture()
      await send(await languageModelFor(entry(providerId, route), { apiKey: 'CONN-KEY', fetch }))
      expect(requests[0]?.url).toStartWith(address)
      expect(requests[0]?.headers.get(header)).toContain('CONN-KEY')

      // A connection without a key sends none — never the server's.
      await send(await languageModelFor(entry(providerId, route), { fetch }))
      expect(values(requests[1]!.headers)).not.toContain('SERVER-')
    })
  }

  test('the gateway needs a key of its own: without one its SDK would sign in as the server', async () => {
    Object.assign(process.env, VARIABLES)
    const gateway = entry('vercel', { family: 'gateway' })
    await expect(languageModelFor(gateway, {})).rejects.toThrow('needs a key')
    await expect(
      decisionModelFor(entry('vercel', { family: 'gateway' }, 'decision'), {}),
    ).rejects.toThrow('needs a key')
  })
})
