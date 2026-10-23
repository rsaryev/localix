/**
 * The resource provider. The claim that matters most is the security one: NO literal credential
 * can reach an expansion, because an expansion is model-facing text that lands in a transcript.
 */

import { describe, expect, test } from 'bun:test'
import {
  createRestResourceProvider,
  expandRequest,
  type ResourceRequestPort,
} from './resource-provider'
import type { RequestSpec } from './request-spec'
import type { CollectionRequest } from './collection/store'

const spec = (over: Partial<RequestSpec> = {}): RequestSpec => ({
  url: 'https://api.github.com/users/octocat',
  method: 'GET',
  headers: [],
  query: [],
  auth: { type: 'none' },
  ...over,
})

const saved = (id: string, over: Partial<RequestSpec> = {}): CollectionRequest => ({
  name: id,
  createdAt: 0,
  updatedAt: 0,
  spec: spec(over),
})

const port = (rows: CollectionRequest[]): ResourceRequestPort => ({
  list: async () => rows,
  get: async (_u, name) => rows.find((r) => r.name === name) ?? null,
})

describe('listChildren', () => {
  test('the roots are the saved requests', async () => {
    const p = createRestResourceProvider(port([saved('github-user'), saved('stripe-charge')]))
    const nodes = await p.listChildren('u', null)
    expect(nodes.map((n) => n.uri)).toEqual([
      'localix://resource/api/github-user',
      'localix://resource/api/stripe-charge',
    ])
    expect(nodes[0].label).toBe('github-user')
  })

  test('a node’s detail says method, url and auth type', async () => {
    const p = createRestResourceProvider(
      port([saved('gh', { method: 'POST', auth: { type: 'bearer', token: 'x' } })]),
    )
    const [node] = await p.listChildren('u', null)
    expect(node.detail).toBe('POST https://api.github.com/users/octocat · bearer')
  })

  test('a request is a leaf — nothing to drill into', async () => {
    const p = createRestResourceProvider(port([saved('gh')]))
    const [node] = await p.listChildren('u', null)
    expect(node.hasChildren).toBe(false)
    // And asking anyway yields nothing rather than the roots again.
    expect(await p.listChildren('u', 'localix://resource/api/gh')).toEqual([])
  })

  test('no saved requests is an empty menu, not a throw', async () => {
    const p = createRestResourceProvider(port([]))
    expect(await p.listChildren('u', null)).toEqual([])
  })
})

describe('expand', () => {
  test('passes session scope through to the collection port', async () => {
    const seen: Array<string | undefined> = []
    const p = createRestResourceProvider({
      list: async (_userId, scope) => {
        seen.push(scope?.sessionId)
        return []
      },
      get: async (_userId, _name, scope) => {
        seen.push(scope?.sessionId)
        return saved('session-request')
      },
    })
    await p.listChildren('u', null, undefined, { sessionId: 'session-a' })
    await p.expand('u', 'localix://resource/api/session-request', { sessionId: 'session-b' })
    expect(seen).toEqual(['session-a', 'session-b'])
  })

  test('resolves a saved request to model-facing text', async () => {
    const p = createRestResourceProvider(port([saved('github-user')]))
    const out = await p.expand('u', 'localix://resource/api/github-user')
    expect(out.ok).toBe(true)
    expect(out.content).toContain('GET https://api.github.com/users/octocat')
  })

  test('an unknown name fails with a reason rather than throwing', async () => {
    const p = createRestResourceProvider(port([]))
    const out = await p.expand('u', 'localix://resource/api/nope')
    expect(out.ok).toBe(false)
    expect(out.error).toContain('nope')
  })

  test('a foreign scheme is refused', async () => {
    const p = createRestResourceProvider(port([saved('gh')]))
    expect((await p.expand('u', 'trade://BTC')).ok).toBe(false)
  })
})

describe('expansion never leaks a credential', () => {
  test('a literal bearer token is masked', () => {
    const text = expandRequest(saved('gh', { auth: { type: 'bearer', token: 'ghp_SUPERSECRET' } }))
    expect(text).not.toContain('ghp_SUPERSECRET')
    expect(text).toContain('bearer')
  })

  test('a literal basic password is masked', () => {
    const text = expandRequest(
      saved('gh', { auth: { type: 'basic', username: 'ada', password: 'hunter2' } }),
    )
    expect(text).not.toContain('hunter2')
  })

  test('a literal api key is masked', () => {
    const text = expandRequest(
      saved('gh', { auth: { type: 'apikey', key: 'X-Api-Key', value: 'sk_live_abc' } }),
    )
    expect(text).not.toContain('sk_live_abc')
  })

  test('a ${secret:KEY} REFERENCE is shown — it is a pointer, not a secret', () => {
    const text = expandRequest(
      saved('gh', { auth: { type: 'bearer', token: '${secret:GH_TOKEN}' } }),
    )
    expect(text).toContain('${secret:GH_TOKEN}')
  })
})

describe('expandRequest content', () => {
  test('lists query, headers and body', () => {
    const text = expandRequest(
      saved('gh', {
        method: 'POST',
        query: [{ name: 'page', value: '2' }],
        headers: [{ name: 'Accept', value: 'application/json' }],
        body: { mimeType: 'application/json', text: '{"a":1}' },
      }),
    )
    expect(text).toContain('page=2')
    expect(text).toContain('Accept: application/json')
    expect(text).toContain('a: 1')
  })

  test('request JSON with an ordinary body field stays admissible and readable', () => {
    const text = expandRequest(
      saved('post', {
        method: 'POST',
        body: {
          mimeType: 'application/json',
          text: '{"body":"ordinary text","access_token":"must-hide"}',
        },
      }),
    )
    expect(text).toContain('body: "ordinary text"')
    expect(text).toContain('access_token: "[redacted]"')
    expect(text).not.toContain('"body":')
    expect(text).not.toContain('must-hide')
  })

  test('a disabled pair is not shown — it is not part of the request', () => {
    const text = expandRequest(
      saved('gh', { headers: [{ name: 'X-Debug', value: '1', disabled: true }] }),
    )
    expect(text).not.toContain('X-Debug')
  })

  test('it tells the model how to send it', () => {
    expect(expandRequest(saved('github-user'))).toContain('{"action":"send","name":"github-user"}')
  })
})
