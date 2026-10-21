import { afterEach, describe, expect, it } from 'bun:test'

import { createProviderConnectionsService } from '../../provider-connections/service'
import { createProviderConditions, refreshFailureReason } from './providers'
import { createTestJournal, openRows, TEST_USER as U, type TestJournal } from './test-journal'

const journals: TestJournal[] = []
afterEach(async () => {
  await Promise.all(journals.splice(0).map((j) => j.close()))
})

/** A service over the journal's own database, with one stored connection whose key is OAuth. */
async function setup() {
  const test = await createTestJournal()
  journals.push(test)
  const vault = new Map<string, string>()
  const conditions = createProviderConditions(test.journal)
  const service = createProviderConnectionsService({
    db: test.db,
    credentialVault: {
      set: async (userId, key, value) => void vault.set(`${userId}:${key}`, value),
      resolve: async (userId, key) => vault.get(`${userId}:${key}`) ?? null,
      delete: async (userId, key) => vault.delete(`${userId}:${key}`),
    },
    onCredentialRefresh: (...args) => conditions.credentialRefreshed(...args),
  })
  return { test, service, vault }
}

describe('a provider connection whose sign-in cannot renew', () => {
  it('is a condition while refreshes fail, settled by the refresh that works, and reopened', async () => {
    const { test } = await setup()
    const conditions = createProviderConditions(test.journal)
    const failed = {
      userId: U,
      connectionId: 'C1',
      label: 'anthropic',
      ok: false,
      error: 'invalid_grant',
    }
    conditions.credentialRefreshed(failed)
    conditions.credentialRefreshed({ ...failed, error: 'invalid_grant (again, differently)' })
    expect((await openRows(test)).map((row) => row.title)).toEqual([
      'Could not renew the sign-in for anthropic',
    ])
    conditions.credentialRefreshed({ userId: U, connectionId: 'C1', label: 'anthropic', ok: true })
    expect(await openRows(test)).toEqual([])
    conditions.credentialRefreshed(failed)
    expect(await openRows(test)).toMatchObject([{ occurrenceCount: 2 }])
  })

  it('does not call a cancelled or timed-out refresh a sign-in failure', () => {
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const timedOut = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    expect(refreshFailureReason(new Error('OAuth refresh failed', { cause: aborted }))).toBeNull()
    expect(refreshFailureReason(timedOut)).toBeNull()
    expect(
      refreshFailureReason(
        new Error('OAuth refresh failed for x', { cause: new Error('invalid_grant') }),
      ),
    ).toBe('OAuth refresh failed for x: invalid_grant')
  })
})

describe('the credential store reports each refresh', () => {
  it('raises when the refresh throws and settles when the next one writes a token', async () => {
    const { test, service, vault } = await setup()
    const connection = await service.createConnection(U, {
      providerId: 'openai',
      providerName: 'OpenAI',
      label: 'OpenAI',
      authType: 'api-key',
      apiKey: 'placeholder-key',
    })
    const keyId = (await service.requireConnection(U, connection.id)).keys[0]!.id
    vault.set(
      `${U}:provider.${keyId}`,
      JSON.stringify({ type: 'oauth', accessToken: 'a', refreshToken: 'r', expiresAt: 0 }),
    )
    const store = await service.credentialStoreFor(U, connection.id, keyId)
    const refreshFailed = new Error('OAuth refresh failed', { cause: new Error('invalid_grant') })
    await expect(
      store.modify!('openai', async () => {
        throw refreshFailed
      }),
    ).rejects.toThrow('OAuth refresh failed')
    const open = await openRows(test)
    expect(open).toHaveLength(1)
    expect(open[0]!.key.startsWith(`condition:provider:${connection.id}:`)).toBe(true)
    expect(open[0]!.body).toContain('invalid_grant')

    await store.modify!('openai', async () => ({
      type: 'oauth' as const,
      accessToken: 'fresh',
      refreshToken: 'r2',
      expiresAt: Number.MAX_SAFE_INTEGER,
    }))
    expect(await openRows(test)).toEqual([])
  })
})

describe('a connection that fails runs the same way', () => {
  const ended = (over: Record<string, unknown>) => ({
    userId: U,
    connectionId: 'C1',
    outcome: 'failed' as const,
    ...over,
  })

  it('a spent quota or a refused key is the connection’s one row, cleared by a completed run', async () => {
    const test = await createTestJournal()
    journals.push(test)
    const conditions = createProviderConditions(test.journal, async () => 'Anthropic')

    await conditions.runEnded(ended({ failure: { rateLimited: true, retryable: true } }))
    await conditions.runEnded(ended({ failure: { rateLimited: true, retryable: true } }))
    let open = await openRows(test)
    expect(open.map((row) => [row.title, row.severity])).toEqual([
      ['Anthropic is rate-limiting requests', 'warning'],
    ])

    // A different problem on the same connection replaces the row rather than joining it.
    await conditions.runEnded(ended({ failure: { authFailed: true } }))
    open = await openRows(test)
    expect(open.map((row) => row.title)).toEqual(['Could not sign in to Anthropic'])
    // A sentence this module owns, never the provider's body — and the control that fixes it.
    expect(open[0]!.body).toBe(
      'Every request on this connection is refused until its key or sign-in is fixed.',
    )
    expect(open[0]!.actions?.[0]).toMatchObject({
      id: 'sign-in',
      kind: 'navigate',
      uri: 'localix://ui/picker/model',
    })

    await conditions.runEnded(ended({ outcome: 'completed' }))
    expect(await openRows(test)).toEqual([])
  })

  it('an ordinary failure, a stop, or a run without a connection says nothing', async () => {
    const test = await createTestJournal()
    journals.push(test)
    const conditions = createProviderConditions(test.journal)
    await conditions.runEnded(ended({ failure: { retryable: false } }))
    await conditions.runEnded(ended({ outcome: 'stopped', failure: { rateLimited: true } }))
    await conditions.runEnded(ended({ connectionId: null, failure: { authFailed: true } }))
    expect(await openRows(test)).toEqual([])
  })
})

describe('a connection whose account sign-in is gone', () => {
  it('is one row per connection, and a connection reconnected or removed settles its row', async () => {
    const test = await createTestJournal()
    journals.push(test)
    const conditions = createProviderConditions(test.journal)
    await conditions.signInsRemoved(U, [
      { connectionId: 'C1', label: 'Anthropic' },
      { connectionId: 'C2', label: 'xAI' },
    ])
    await conditions.signInsRemoved(U, [
      { connectionId: 'C1', label: 'Anthropic' },
      { connectionId: 'C2', label: 'xAI' },
    ])
    expect((await openRows(test)).map((row) => row.title).sort()).toEqual([
      'Anthropic needs an API key',
      'xAI needs an API key',
    ])
    // C2 was removed (or reconnected with a key): the next report no longer names it.
    await conditions.signInsRemoved(U, [{ connectionId: 'C1', label: 'Anthropic' }])
    expect((await openRows(test)).map((row) => row.title)).toEqual(['Anthropic needs an API key'])
  })
})
