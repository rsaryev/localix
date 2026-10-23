/**
 * The import action. The store is a stub — the point is the naming and the preview/save split,
 * neither of which needs a filesystem.
 */

import { describe, expect, test } from 'bun:test'
import { runImportAction, uniqueNames } from './import-action'
import type { CollectionRequest, CollectionStore } from './collection/store'
import { createMemoryCollection } from './collection/testing/memory'
import type { ImportedRequest } from './import/types'

/** The shared in-memory collection — the same double the route tests use. */
function stubStore(initial: CollectionRequest[] = []) {
  const store = createMemoryCollection(initial.map((r) => ({ name: r.name, spec: r.spec })))
  /** What is in the collection right now, in name order. A getter, not a snapshot: the action
   *  under test writes through `store`, and a captured array would never see it. */
  const rows = () => [...store.records.values()].sort((a, b) => a.name.localeCompare(b.name))
  return { store, rows }
}

const saved = (id: string): CollectionRequest => ({
  name: id,
  createdAt: 0,
  updatedAt: 0,
  spec: { url: 'https://api.dev/x', method: 'GET', headers: [], query: [], auth: { type: 'none' } },
})

const imported = (name: string): ImportedRequest => ({
  name,
  spec: { url: 'https://api.dev/x', method: 'GET', headers: [], query: [], auth: { type: 'none' } },
})

describe('uniqueNames', () => {
  test('leaves an unused name alone', async () => {
    const { store } = stubStore()
    const out = await uniqueNames(store, [imported('api-users')])
    expect(out.map((r) => r.name)).toEqual(['api-users'])
  })

  test('suffixes around a name already in the store rather than overwriting it', async () => {
    const { store } = stubStore([saved('api-users')])
    const out = await uniqueNames(store, [imported('api-users')])
    expect(out.map((r) => r.name)).toEqual(['api-users-2'])
  })

  test('deduplicates WITHIN a batch — a HAR hits one endpoint repeatedly', async () => {
    const { store } = stubStore()
    const out = await uniqueNames(store, [
      imported('api-users'),
      imported('api-users'),
      imported('api-users'),
    ])
    expect(out.map((r) => r.name)).toEqual(['api-users', 'api-users-2', 'api-users-3'])
  })

  test('keeps counting past a stored name AND a batch collision', async () => {
    const { store } = stubStore([saved('api-users'), saved('api-users-2')])
    const out = await uniqueNames(store, [imported('api-users'), imported('api-users')])
    expect(out.map((r) => r.name)).toEqual(['api-users-3', 'api-users-4'])
  })
})

describe('runImportAction', () => {
  const deps = (initial: CollectionRequest[] = []) => {
    const { store, rows } = stubStore(initial)
    return { deps: { store, userId: 'u' }, rows }
  }

  test('an unrecognised source is a fix-it message naming the formats', async () => {
    const { deps: d } = deps()
    const out = await runImportAction(d, 'GET /users HTTP/1.1', false)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.problem).toContain('cURL')
      expect(out.problem).toContain('HAR')
    }
  })

  test('import previews by default and writes nothing', async () => {
    const { deps: d, rows } = deps()
    const out = await runImportAction(d, 'curl https://api.github.com/users/octocat', false)
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.content).toContain('Not saved yet')
      expect(out.content).toContain('api-users-octocat')
    }
    expect(rows()).toHaveLength(0)
  })

  test('the person is told the same report without the tool calls meant for the agent', async () => {
    const { deps: d } = deps()
    const preview = await runImportAction(d, 'curl https://api.github.com/users/octocat', false)
    const saved = await runImportAction(d, 'curl https://api.github.com/users/octocat', true)
    const failed = await runImportAction(d, 'GET /users HTTP/1.1', false)
    if (!preview.ok || !saved.ok || failed.ok) throw new Error('unexpected outcome')
    expect(preview.content).toContain('{"action":"import"')
    expect(preview.message).toContain('Not saved yet')
    expect(preview.message).toContain('api-users-octocat')
    expect(saved.content).toContain('{"action":"send"')
    expect(saved.message).toContain('Imported 1 request')
    expect(failed.problem).toContain('{"action":"save"')
    expect(failed.message).toContain('HAR')
    for (const message of [preview.message, saved.message, failed.message])
      expect(message).not.toContain('{"action"')
  })

  test('save: true writes the requests', async () => {
    const { deps: d, rows } = deps()
    const out = await runImportAction(d, 'curl https://api.github.com/users/octocat', true)
    expect(out.ok).toBe(true)
    expect(rows()).toHaveLength(1)
    expect(rows()[0].name).toBe('api-users-octocat')
    expect(rows()[0].spec.url).toBe('https://api.github.com/users/octocat')
  })

  test('an import with no credential says nothing about the vault', async () => {
    const { deps: d } = deps()
    const out = await runImportAction(d, 'curl https://api.dev/x', true)
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.content).not.toContain('secret')
  })

  test('a bulk HAR import saves every entry under a distinct name', async () => {
    const { deps: d, rows } = deps()
    const har = JSON.stringify({
      log: {
        entries: [
          { request: { method: 'GET', url: 'https://api.dev/v1/users' } },
          { request: { method: 'POST', url: 'https://api.dev/v1/users' } },
        ],
      },
    })
    const out = await runImportAction(d, har, true)
    expect(out.ok).toBe(true)
    expect(rows().map((r) => r.name)).toEqual(['api-v1-users', 'api-v1-users-2'])
  })

  test('the preview masks a literal credential', async () => {
    const { deps: d } = deps()
    const out = await runImportAction(d, `curl -u ada:hunter2 https://api.dev/x`, false)
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.content).not.toContain('hunter2')
  })
})

describe('an imported credential lands in the vault, not in the store', () => {
  /** A store + a vault, so the two can be checked against each other. */
  const vaultDeps = (opts: { taken?: string[]; writer?: boolean } = {}) => {
    const { store, rows } = stubStore()
    const exists = new Set(opts.taken ?? [])
    const written = new Map<string, string>()
    const storeSecret = async (_u: string, key: string, value: string) => {
      if (exists.has(key)) return false
      exists.add(key)
      written.set(key, value)
      return true
    }
    return {
      deps: { store, userId: 'u', storeSecret: opts.writer === false ? undefined : storeSecret },
      rows,
      written,
    }
  }

  const CURL = `curl -H 'Authorization: Bearer ghp_SUPERSECRET' https://api.github.com/user`

  test('the literal is vaulted and the STORE holds only a reference', async () => {
    const { deps: d, rows, written } = vaultDeps()
    const out = await runImportAction(d, CURL, true)
    expect(out.ok).toBe(true)

    // The store — the file on disk — never sees the token.
    expect(JSON.stringify(rows())).not.toContain('ghp_SUPERSECRET')
    expect(rows()[0].spec.auth).toEqual({ type: 'bearer', token: '${secret:REST_API_USER_TOKEN}' })
    // The vault has it.
    expect(written.get('REST_API_USER_TOKEN')).toBe('ghp_SUPERSECRET')
  })

  test('NO write to the store ever carried the literal — not even briefly', async () => {
    // The claim in import-action.ts is TEMPORAL: "the plaintext must never reach the request store
    // at all, not even briefly. A stored-then-vaulted order would leave the secret in a file on
    // disk between the two writes, and a crash in that window leaves it there for good."
    //
    // Asserting the FINAL rows cannot test that — `save` overwrites by name, so a
    // store-literal → vault → store-reference order would leave identical final state and this
    // group would stay green while the claim was false. Only the sequence of writes can falsify it.
    const { store, rows } = stubStore()
    const writes: string[] = []
    const spy: CollectionStore = {
      ...store,
      save: async (name, spec) => {
        writes.push(JSON.stringify({ name, spec }))
        return store.save(name, spec)
      },
    }
    const written = new Map<string, string>()
    const out = await runImportAction(
      {
        store: spy,
        userId: 'u',
        storeSecret: async (_u, k, v) => {
          written.set(k, v)
          return true
        },
      },
      CURL,
      true,
    )
    expect(out.ok).toBe(true)
    expect(writes).toHaveLength(1)
    for (const write of writes) expect(write).not.toContain('ghp_SUPERSECRET')
    // And the vault really did get it — otherwise "no write carried it" is true and useless.
    expect(written.get('REST_API_USER_TOKEN')).toBe('ghp_SUPERSECRET')
    expect(rows()).toHaveLength(1)
  })

  test('the report names the key, so the user can find what was created', async () => {
    const { deps: d } = vaultDeps()
    const out = await runImportAction(d, CURL, true)
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.content).toContain('secrets vault')
      expect(out.content).toContain('REST_API_USER_TOKEN')
    }
  })

  test('nothing is vaulted on a PREVIEW — a preview writes nowhere at all', async () => {
    const { deps: d, rows, written } = vaultDeps()
    await runImportAction(d, CURL, false)
    expect(rows()).toHaveLength(0)
    expect(written.size).toBe(0)
  })

  test('a taken key suffixes rather than clobbering the existing secret', async () => {
    const { deps: d, rows, written } = vaultDeps({ taken: ['REST_API_USER_TOKEN'] })
    await runImportAction(d, CURL, true)
    expect(written.get('REST_API_USER_TOKEN_2')).toBe('ghp_SUPERSECRET')
    expect(rows()[0].spec.auth).toEqual({
      type: 'bearer',
      token: '${secret:REST_API_USER_TOKEN_2}',
    })
  })

  test('with no vault writer the request is REFUSED, and the refusal is reported', async () => {
    // This used to be "the literal is kept and the miss is reported" — honest degradation for a
    // store nobody could see. The collection is a directory in the repo now, so keeping the
    // literal would commit a credential, and refusing is the only safe answer. What must NOT
    // happen is refusing QUIETLY: an import that reports success while dropping requests is
    // worse than either.
    const { deps: d, rows } = vaultDeps({ writer: false })
    const out = await runImportAction(d, CURL, true)
    expect(rows()).toHaveLength(0)
    // …and we say so rather than implying it was secured.
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.content).toContain('could NOT be vaulted')
  })
})
