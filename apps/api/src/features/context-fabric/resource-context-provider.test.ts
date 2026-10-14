import { describe, expect, test } from 'bun:test'
import { parseResourceUri } from '@localixai/plugin-sdk/backend'

import type { ContextReference, ContextResolver } from './contracts'
import {
  createResourceContextProvider,
  namespacedResourceKind,
  type ResourceContextExpander,
} from './resource-context-provider'

const ctx = { destination: 'chat' as const, userId: 'u', sessionId: 's', maxBytes: 10_000 }

function reference(uri: string): ContextReference {
  return {
    version: 1,
    id: 'selected',
    kind: 'resource',
    uri,
    freshness: 'resolve-at-send',
    presentation: { label: 'Selected' },
    scope: { userId: 'u', sessionId: 's' },
  }
}

/** Records every read so capture-once/never-after-abort can be asserted. */
function expander(expansion: { ok: boolean; content?: string; language?: string }) {
  const reads: string[] = []
  const port: ResourceContextExpander = {
    async expand(userId, uri) {
      reads.push(`${userId} ${uri}`)
      return expansion
    },
  }
  return { port, reads }
}

const resolverOf = (contribution: ReturnType<typeof createResourceContextProvider>) =>
  contribution.provider as ContextResolver

describe('resource context-provider factory', () => {
  test('emits one revisioned contribution captured from the domain expander', async () => {
    const { port, reads } = expander({
      ok: true,
      content: 'diff --git a/a.ts\n+safe\n',
      language: 'diff',
    })
    const contribution = createResourceContextProvider({
      id: 'git-context',
      provider: 'git',
      namespace: 'git',
      expander: port,
    })
    expect(contribution.destinations).toEqual(['edit-prediction', 'inline-completion', 'chat'])
    expect(contribution.activation).toBe('explicit')
    expect(contribution.sensitivity).toBe('project')

    const resolver = resolverOf(contribution)
    const result = await resolver.resolve(
      reference('localix://resource/git/p/status'),
      ctx,
      new AbortController().signal,
    )
    expect(result).toEqual([
      expect.objectContaining({
        id: 'git-resource:selected',
        providerId: 'git-context',
        providerVersion: '1',
        scope: 'session',
        kind: 'git/diff',
        uri: 'localix://resource/git/p/status',
        priority: 1_000,
        sensitivity: 'project',
      }),
    ])
    expect(result[0]?.revision).toMatch(/^git-content:[0-9a-f]+:\d+$/)
    expect(reads).toEqual(['u localix://resource/git/p/status'])
  })

  test('scopes ownership to its own provider', () => {
    const resolver = resolverOf(
      createResourceContextProvider({
        id: 'fixture:container-context',
        provider: 'fixture-container',
        namespace: 'container',
        expander: expander({ ok: true, content: 'x' }).port,
      }),
    )
    expect(resolver.supports(reference('localix://resource/fixture-container/abc'), 'chat')).toBe(
      true,
    )
    expect(resolver.supports(reference('localix://resource/git/p/status'), 'chat')).toBe(false)
    expect(
      resolver.supports(
        { ...reference('localix://resource/fixture-container/abc'), kind: 'file' },
        'chat',
      ),
    ).toBe(false)
    expect(
      resolver.supports(reference('localix://resource/fixture-container/abc'), 'title-generation'),
    ).toBe(false)
  })

  test('never reads after cancellation', async () => {
    const { port, reads } = expander({ ok: true, content: 'x' })
    const resolver = resolverOf(
      createResourceContextProvider({
        id: 'fixture:cluster-context',
        provider: 'fixture-cluster',
        namespace: 'cluster',
        expander: port,
      }),
    )
    const controller = new AbortController()
    controller.abort()
    expect(
      await resolver.resolve(
        reference('localix://resource/fixture-cluster/ctx/ns/pod'),
        ctx,
        controller.signal,
      ),
    ).toEqual([])
    expect(
      await resolver.estimate(
        reference('localix://resource/fixture-cluster/ctx/ns/pod'),
        ctx,
        controller.signal,
      ),
    ).toEqual({
      bytes: 0,
      tokens: 0,
    })
    expect(reads).toEqual([])
  })

  test('a failed or empty expansion contributes nothing', async () => {
    const resolver = resolverOf(
      createResourceContextProvider({
        id: 'fixture:cluster-context',
        provider: 'fixture-cluster',
        namespace: 'cluster',
        expander: expander({ ok: false }).port,
      }),
    )
    expect(
      await resolver.resolve(
        reference('localix://resource/fixture-cluster/ctx/ns/pod'),
        ctx,
        new AbortController().signal,
      ),
    ).toEqual([])
    expect(
      await resolver.estimate(
        reference('localix://resource/fixture-cluster/ctx/ns/pod'),
        ctx,
        new AbortController().signal,
      ),
    ).toEqual({ bytes: 0, tokens: 0 })
  })

  test('namespace, not provider, names the emitted artefacts', async () => {
    const resolver = resolverOf(
      createResourceContextProvider({
        id: 'fixture:cluster-context',
        provider: 'fixture-cluster',
        namespace: 'cluster',
        expander: expander({ ok: true, content: 'kind: Pod' }).port,
      }),
    )
    const [contribution] = await resolver.resolve(
      reference('localix://resource/fixture-cluster/ctx/ns/pod'),
      ctx,
      new AbortController().signal,
    )
    expect(contribution?.id).toBe('cluster-resource:selected')
    expect(contribution?.kind).toBe('cluster-resource')
    // The revision namespace still tracks the resource provider unless overridden.
    expect(contribution?.revision).toMatch(/^fixture-cluster-content:/)
  })

  test('a domain may override the kind mapping (catalog maps sql → schema)', async () => {
    const kind = (language: string | undefined) =>
      language === 'sql' ? 'catalog-schema' : 'catalog-resource'
    const build = (language?: string) =>
      resolverOf(
        createResourceContextProvider({
          id: 'fixture:context',
          provider: 'fixture-db',
          namespace: 'catalog',
          kind,
          expander: expander({ ok: true, content: 'CREATE TABLE t', language }).port,
        }),
      )
    const sql = await build('sql').resolve(
      reference('localix://resource/fixture-db/c/_/s/t'),
      ctx,
      new AbortController().signal,
    )
    expect(sql[0]?.kind).toBe('catalog-schema')
    expect(sql[0]?.id).toBe('catalog-resource:selected')
    expect(sql[0]?.revision).toMatch(/^fixture-db-content:/)
    const other = await build().resolve(
      reference('localix://resource/fixture-db/c/_/s/t'),
      ctx,
      new AbortController().signal,
    )
    expect(other[0]?.kind).toBe('catalog-resource')
  })

  test('a hierarchical domain may rank a specific resource above its broad root', async () => {
    const resolver = resolverOf(
      createResourceContextProvider({
        id: 'fixture:context',
        provider: 'fixture-db',
        namespace: 'catalog',
        priority: (uri) => ((parseResourceUri(uri)?.segments.length ?? 0) > 1 ? 1_300 : 900),
        expander: expander({ ok: true, content: 'schema', language: 'sql' }).port,
      }),
    )
    const [root] = await resolver.resolve(
      reference('localix://resource/fixture-db/c'),
      ctx,
      new AbortController().signal,
    )
    const [table] = await resolver.resolve(
      reference('localix://resource/fixture-db/c/_/public/users'),
      ctx,
      new AbortController().signal,
    )
    expect(root?.priority).toBe(900)
    expect(table?.priority).toBe(1_300)
  })

  test('a domain may admit only part of its own URI tree, on every entry point', async () => {
    const { port, reads } = expander({ ok: true, content: 'BTC/USD mid 100' })
    const contribution = createResourceContextProvider({
      id: 'fixture:market-context',
      provider: 'fixture-market',
      namespace: 'market-public',
      revisionPrefix: 'fixture-market-public-content',
      sensitivity: 'public',
      kind: () => 'market-public-data',
      accepts: (uri) => uri.startsWith('localix://resource/fixture-market/public%3A'),
      expander: port,
    })
    const resolver = resolverOf(contribution)
    expect(contribution.sensitivity).toBe('public')

    const priv = reference('localix://resource/fixture-market/acct-1/balances')
    expect(resolver.supports(priv, 'chat')).toBe(false)
    expect(await resolver.resolve(priv, ctx, new AbortController().signal)).toEqual([])
    expect(await resolver.estimate(priv, ctx, new AbortController().signal)).toEqual({
      bytes: 0,
      tokens: 0,
    })
    expect(reads).toEqual([])

    const pub = reference('localix://resource/fixture-market/public%3Abinance/BTC-USD')
    expect(resolver.supports(pub, 'chat')).toBe(true)
    const [captured] = await resolver.resolve(pub, ctx, new AbortController().signal)
    expect(captured?.kind).toBe('market-public-data')
    expect(captured?.sensitivity).toBe('public')
    expect(captured?.revision).toMatch(/^fixture-market-public-content:/)
  })

  test('estimate sizes the capture in bytes and reports the same revision resolve will', async () => {
    const content = 'héllo'
    const resolver = resolverOf(
      createResourceContextProvider({
        id: 'git-context',
        provider: 'git',
        namespace: 'git',
        expander: expander({ ok: true, content }).port,
      }),
    )
    const estimate = await resolver.estimate(
      reference('localix://resource/git/p/status'),
      ctx,
      new AbortController().signal,
    )
    const [captured] = await resolver.resolve(
      reference('localix://resource/git/p/status'),
      ctx,
      new AbortController().signal,
    )
    expect(estimate.bytes).toBe(6) // byte length, not char length
    expect(estimate.tokens).toBe(2)
    expect(estimate.revision).toBe(captured?.revision)
  })

  test('namespacedResourceKind is the default kind shape', () => {
    const kind = namespacedResourceKind('container')
    expect(kind('json')).toBe('container/json')
    expect(kind(undefined)).toBe('container-resource')
  })
})

describe('provider derivation', () => {
  test('derives the provider from the expander — a caller never re-spells it', async () => {
    // A real domain expander IS its `ResourceRefProvider`, and that carries `.provider`.
    const { port } = expander({ ok: true, content: 'diff' })
    const contribution = createResourceContextProvider({
      id: 'git-context',
      namespace: 'git',
      expander: { ...port, provider: 'git' },
    })
    const resolver = resolverOf(contribution)

    expect(resolver.supports(reference('localix://resource/git/p/commits/abc'), 'chat')).toBe(true)
    expect(resolver.supports(reference('localix://resource/fixture-db/c/_/s/t'), 'chat')).toBe(
      false,
    )

    // …and the derived provider also names the default revision prefix.
    const estimate = await resolver.estimate!(
      reference('localix://resource/git/p/commits/abc'),
      ctx,
      new AbortController().signal,
    )
    expect(estimate.revision).toStartWith('git-content:')
  })

  test('an explicit `provider` still wins, for an expander that carries none', () => {
    const { port } = expander({ ok: true, content: 'x' })
    const resolver = resolverOf(
      createResourceContextProvider({
        id: 'x-context',
        provider: 'fixture-db',
        namespace: 'catalog',
        expander: port,
      }),
    )
    expect(resolver.supports(reference('localix://resource/fixture-db/c/_/s/t'), 'chat')).toBe(true)
  })

  test('neither a spec provider nor an expander provider is a WIRING bug — it throws at construction', () => {
    const { port } = expander({ ok: true, content: 'x' })
    expect(() =>
      createResourceContextProvider({ id: 'nope', namespace: 'nope', expander: port }),
    ).toThrow(/no provider/)
  })
})
