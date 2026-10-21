import { describe, expect, test } from 'bun:test'

import type { ProviderConnection } from './contracts'
import { removedSignIns, reportRemovedSignIns } from './removed-sign-ins'

/** An account sign-in the engine no longer offers is found, and only that. */
const connection = (
  id: string,
  providerId: string,
  authType: ProviderConnection['authType'],
): ProviderConnection =>
  ({
    id,
    providerId,
    providerName: providerId,
    label: `${providerId} (${authType})`,
    authType,
    hasApiKey: true,
    keyCount: 1,
    keys: [],
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-21T00:00:00.000Z',
  }) as ProviderConnection

const connections = [
  connection('c1', 'anthropic', 'oauth-pkce'),
  connection('c2', 'openai-codex', 'oauth-pkce'),
  connection('c3', 'anthropic', 'api-key'),
]

describe('connections whose account sign-in is gone', () => {
  test('are the OAuth ones no sign-in serves; a key connection to the same provider is fine', () => {
    expect(removedSignIns(connections, ['openai-codex', 'openrouter'])).toEqual([
      { connectionId: 'c1', label: 'anthropic (oauth-pkce)' },
    ])
  })

  test('are not reported while the catalog has not said which sign-ins exist', async () => {
    const reports: unknown[] = []
    const deps = {
      listConnections: async () => ({ connections }),
      oauthProviderIds: async () => [] as string[],
      report: async (_userId: string, broken: unknown) => void reports.push(broken),
    }
    await reportRemovedSignIns(deps, 'u')
    expect(reports).toEqual([])
    await reportRemovedSignIns({ ...deps, oauthProviderIds: async () => ['openai-codex'] }, 'u')
    expect(reports).toEqual([[{ connectionId: 'c1', label: 'anthropic (oauth-pkce)' }]])
  })
})
