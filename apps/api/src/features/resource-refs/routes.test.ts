import { describe, expect, test } from 'bun:test'

import {
  buildResourceUri,
  createResourceProviderRegistry,
  type ResourceRefProvider,
} from '@localixai/mini-app-sdk/backend'
import { ApiError } from '../../lib/errors'
import { createResourceRefRoutes, MAX_RESOURCE_PARTIAL_BYTES } from './routes'

const provider = (provider: string, title: string): ResourceRefProvider => ({
  provider,
  title,
  async listChildren(_userId, parent) {
    if (parent === null) {
      return [
        { uri: buildResourceUri(provider, ['root']), label: `${title} root`, hasChildren: true },
      ]
    }
    return [{ uri: `${parent}/child`, label: 'child', hasChildren: false }]
  },
  async expand() {
    return { ok: true, content: '' }
  },
})

/** The ownership gate: only `session-42` is the caller's. */
const OWNS_SESSION_42 = {
  assertSessionAccess: async (_userId: string, sessionId: string) => {
    if (sessionId !== 'session-42')
      throw new ApiError(404, 'session_not_found', 'Session not found')
  },
}

describe('GET /rpc/resource-refs contract', () => {
  test('passes the active session scope to resource providers', async () => {
    let seenSessionId: string | undefined
    const registry = createResourceProviderRegistry()
    registry.register({
      ...provider('fixture-course', 'Courses'),
      async listChildren(_userId, _parent, _query, scope) {
        seenSessionId = scope?.sessionId
        return []
      },
    })
    const route = createResourceRefRoutes(registry, OWNS_SESSION_42)

    await route.request(
      '/?partial=' +
        encodeURIComponent('localix://resource/fixture-course/') +
        '&sessionId=session-42',
    )

    expect(seenSessionId).toBe('session-42')
  })

  test('a session the caller does not own is rejected before any provider sees it', async () => {
    // The id used to reach the provider scope exactly as the query string spelled it.
    let calls = 0
    const registry = createResourceProviderRegistry()
    registry.register({
      ...provider('fixture-course', 'Courses'),
      async listChildren() {
        calls += 1
        return []
      },
    })
    const route = createResourceRefRoutes(registry, OWNS_SESSION_42)

    const response = await route.request(
      '/?partial=' +
        encodeURIComponent('localix://resource/fixture-course/') +
        '&sessionId=someone-elses',
    )

    expect(response.status).toBe(404)
    expect(calls).toBe(0)
  })

  test('returns the versioned grouped browse result from one raw partial', async () => {
    const registry = createResourceProviderRegistry()
    registry.register(provider('git', 'Repositories'))
    registry.register(provider('fixture-db', 'Catalogs'))
    registry.register(provider('chat', 'Chats'))
    registry.register(provider('fixture-container', 'Containers'))
    registry.register(provider('fixture-cluster', 'Clusters'))
    registry.register(provider('fixture-doc', 'Documents'))
    const route = createResourceRefRoutes(registry, OWNS_SESSION_42)

    const roots = (await (await route.request('/?partial=')).json()) as Record<string, unknown>
    expect(roots).toMatchObject({
      version: 1,
      parent: null,
      provider: null,
      segment: '',
    })
    expect((roots.groups as Array<{ label: string }>).map((group) => group.label)).toEqual([
      'Catalogs',
      'Chats',
      'Clusters',
      'Containers',
      'Documents',
      'Repositories',
    ])

    const scoped = (await (
      await route.request('/?partial=' + encodeURIComponent('localix://resource/fixture-db/'))
    ).json()) as { provider: string | null; groups: Array<{ provider: string }> }
    expect(scoped.provider).toBe('fixture-db')
    expect(scoped.groups.map((group) => group.provider)).toEqual(['fixture-db'])
  })

  test('rejects oversized, control-byte, and encoded traversal input before provider IO', async () => {
    let calls = 0
    const registry = createResourceProviderRegistry()
    registry.register({
      ...provider('fixture-doc', 'Documents'),
      async listChildren(...args) {
        calls += 1
        return provider('fixture-doc', 'Documents').listChildren(...args)
      },
    })
    const route = createResourceRefRoutes(registry, OWNS_SESSION_42)

    for (const partial of [
      'x'.repeat(MAX_RESOURCE_PARTIAL_BYTES + 1),
      'localix://resource/fixture-doc/root/%2e%2e/secrets',
      'localix://resource/fixture-doc/root/..%252Fsecrets',
      'localix://resource/fixture-doc/root/\u001b[31m',
    ]) {
      const response = await route.request('/?partial=' + encodeURIComponent(partial))
      expect(response.status).toBe(400)
    }
    expect(calls).toBe(0)
  })
})
