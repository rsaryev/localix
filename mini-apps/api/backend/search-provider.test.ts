import { searchHitsOf } from '@localixai/mini-app-sdk/backend'
/**
 * The search provider. Its two contractual promises: hit ids are `localix://resource/api/` URIs (so a result is
 * draggable into chat), and search MUST resolve — a throw here would take down the whole
 * federated search, not just our group.
 */

import { describe, expect, test } from 'bun:test'
import { createRestSearchProvider, requestSubtitle } from './search-provider'
import type { ResourceRequestPort } from './resource-provider'
import type { RequestSpec } from './request-spec'
import type { CollectionRequest } from './collection/store'

const saved = (id: string, over: Partial<RequestSpec> = {}): CollectionRequest => ({
  name: id,
  createdAt: 0,
  updatedAt: 0,
  spec: {
    url: 'https://api.github.com/users/octocat',
    method: 'GET',
    headers: [],
    query: [],
    auth: { type: 'none' },
    ...over,
  },
})

const port = (rows: CollectionRequest[]): ResourceRequestPort => ({
  list: async () => rows,
  get: async (_u, name) => rows.find((r) => r.name === name) ?? null,
})

const search = (rows: CollectionRequest[], text: string) =>
  createRestSearchProvider(port(rows)).search('u', { text }).then(searchHitsOf)

describe('provider shape', () => {
  test('it is eager — the corpus is one small local file', () => {
    expect(createRestSearchProvider(port([])).tier).toBe('eager')
  })

  test('search reads the active session collection', async () => {
    let sessionId: string | undefined
    const scoped: ResourceRequestPort = {
      list: async (_userId, scope) => {
        sessionId = scope?.sessionId
        return [saved('only-here')]
      },
      get: async () => null,
    }
    await createRestSearchProvider(scoped).search('u', {
      text: 'only',
      sessionId: 'session-a',
    })
    expect(sessionId).toBe('session-a')
  })
})

describe('matching', () => {
  test('matches on name', async () => {
    // The other request must not share github's url, or it matches on THAT — which is the
    // feature below, not a name match.
    const other = saved('stripe-charge', { url: 'https://api.stripe.com/v1/charges' })
    const hits = await search([saved('github-user'), other], 'github')
    expect(hits.map((h) => h.title)).toEqual(['github-user'])
  })

  test('matches on url even when the name does not say it', async () => {
    const hits = await search(
      [saved('my-thing', { url: 'https://api.stripe.com/v1/charges' })],
      'stripe',
    )
    expect(hits).toHaveLength(1)
  })

  test('matches on method', async () => {
    const hits = await search([saved('a', { method: 'DELETE' })], 'DELETE')
    expect(hits).toHaveLength(1)
  })

  test('an unrelated query matches nothing rather than everything', async () => {
    expect(await search([saved('github-user')], 'zzzzzzqqq')).toEqual([])
  })

  test('no saved requests is an empty result', async () => {
    expect(await search([], 'anything')).toEqual([])
  })
})

describe('hits are re-openable', () => {
  test('the id is the localix://resource/api/ URI, so a hit drags into chat', async () => {
    const [hit] = await search([saved('github-user')], 'github')
    expect(hit.id).toBe('localix://resource/api/github-user')
    expect(hit.domain).toBe('api:requests')
  })

  test('a name needing encoding still yields a valid URI', async () => {
    const [hit] = await search([saved('weird/name')], 'weird')
    expect(hit.id).toBe('localix://resource/api/weird%2Fname')
  })
})

describe('a hit never leaks a credential', () => {
  test('the subtitle carries the auth TYPE, not its value', async () => {
    const [hit] = await search(
      [saved('gh', { auth: { type: 'bearer', token: 'ghp_SECRET' } })],
      'gh',
    )
    expect(hit.subtitle).toContain('bearer')
    expect(JSON.stringify(hit)).not.toContain('ghp_SECRET')
  })
})

describe('search must resolve, never throw', () => {
  test('a store failure degrades to [] rather than breaking federated search', async () => {
    const broken: ResourceRequestPort = {
      list: async () => {
        throw new Error('disk gone')
      },
      get: async () => null,
    }
    expect(await createRestSearchProvider(broken).search('u', { text: 'x' })).toEqual([])
  })
})

describe('requestSubtitle', () => {
  test('says method and url', () => {
    expect(requestSubtitle('GET', 'https://api.dev/x', 'none')).toBe('GET https://api.dev/x')
  })

  test('adds the auth type when there is one', () => {
    expect(requestSubtitle('POST', 'https://api.dev/x', 'bearer')).toBe(
      'POST https://api.dev/x · bearer',
    )
  })
})
