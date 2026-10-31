import { describe, expect, it } from 'bun:test'
import {
  createResourceProviderRegistry,
  linkAction,
  noticeNode,
  parseResourceUri,
  providerSegments,
  truncationNotice,
  type ResourceRefProvider,
} from '@localixai/mini-app-sdk/backend'
import { expandContextRefs, type ResourceRefLoader } from '../../projects/expand-refs'
import { parseContextRefs, toWireRef } from '../../../contracts/context-refs'
import type { ContextRef } from '../../projects/contracts'

/**
 * The loader the HOST actually installs. The registry's `ResourceExpansion` is a weak
 * bag (`ok: boolean` + optional `content`/`error`), while `ResourceRefLoader` wants the
 * discriminated `ResourceExpansionResult` — so bootstrap.ts normalizes between them.
 * These tests used to wire `reg.expand` RAW, i.e. exercise a loader shape production
 * never produces; going through the same normalization is what makes them a guard on
 * the real path. (The duplication is a smell: the normalizer belongs on the registry,
 * but the strict type lives in features/projects — reported, not moved.)
 */
const hostLoader =
  (reg: {
    expand(
      userId: string,
      uri: string,
    ): Promise<{ ok: boolean; content?: string; language?: string; error?: string }>
  }): ResourceRefLoader =>
  async (uri) => {
    const r = await reg.expand('u1', uri)
    return r.ok
      ? { ok: true, content: r.content ?? '', language: r.language }
      : { ok: false, error: r.error ?? 'resource unavailable' }
  }

/** A trivial in-memory provider: roots → one node with a child leaf. */
function fakeProvider(): ResourceRefProvider {
  return {
    provider: 'fake',
    title: 'Fakes',
    async listChildren(_userId, parentUri) {
      if (parentUri === null)
        return [
          {
            uri: 'localix://resource/fake/root',
            label: 'root',
            hasChildren: true,
            icon: 'connection',
          },
        ]
      if (parentUri === 'localix://resource/fake/root')
        return [{ uri: 'localix://resource/fake/root/leaf', label: 'leaf', hasChildren: false }]
      return []
    },
    async expand(_userId, uri) {
      if (uri === 'localix://resource/fake/root/leaf')
        return { ok: true, content: 'LEAF CONTENT', language: 'sql' }
      return { ok: false, error: 'no such node' }
    },
  }
}

describe('parseResourceUri', () => {
  it('splits provider + segments, dropping empty ones', () => {
    expect(parseResourceUri('localix://resource/fixture-db/c1/_/public/orders')).toEqual({
      provider: 'fixture-db',
      rest: 'c1/_/public/orders',
      segments: ['c1', '_', 'public', 'orders'],
    })
  })
  it('returns null without a provider', () => {
    expect(parseResourceUri('no-provider/here')).toBeNull()
    expect(parseResourceUri('://leading')).toBeNull()
  })
})

describe('provider node helpers', () => {
  it('providerSegments guards the provider and yields segments', () => {
    expect(providerSegments('fixture-db', 'localix://resource/fixture-db/c1/_/public')).toEqual([
      'c1',
      '_',
      'public',
    ])
    expect(providerSegments('fixture-db', 'localix://resource/git/p1')).toBeNull()
    expect(providerSegments('fixture-db', 'not a uri')).toBeNull()
  })
  it('linkAction shapes the single-link actions declaration', () => {
    expect(linkAction('Link this table')).toEqual([
      { id: 'link', label: 'Link this table', kind: 'link' },
    ])
  })
  it('noticeNode / truncationNotice mint non-drillable notice rows off the parent uri', () => {
    const n = noticeNode('localix://resource/fixture-db/c1', 'Could not list', 'boom')
    expect(n).toEqual({
      uri: 'localix://resource/fixture-db/c1#notice',
      label: 'Could not list',
      detail: 'boom',
      hasChildren: false,
      notice: true,
    })
    const t = truncationNotice('localix://resource/git/p/commits', 50, 200, 'commits', 'fix')
    expect(t.notice).toBe(true)
    expect(t.label).toBe('Showing 50 of 200 matching "fix" commits')
    expect(t.detail).toBe('type to search the full list')
  })
})

describe('ResourceProviderRegistry', () => {
  it('lists roots across providers and drills by provider', async () => {
    const reg = createResourceProviderRegistry()
    reg.register(fakeProvider())
    const roots = await reg.listChildren('u1', null)
    expect(roots.map((n) => n.uri)).toEqual(['localix://resource/fake/root'])
    // Roots are tagged with the provider's title so the menu can group by type.
    expect(roots[0]?.group).toBe('Fakes')
    const children = await reg.listChildren('u1', 'localix://resource/fake/root')
    expect(children.map((n) => n.uri)).toEqual(['localix://resource/fake/root/leaf'])
    // Drilled child nodes are NOT tagged with a group (only roots get headers).
    expect(children[0]?.group).toBeUndefined()
  })

  it('expands by provider; unknown provider soft-fails', async () => {
    const reg = createResourceProviderRegistry()
    reg.register(fakeProvider())
    expect(await reg.expand('u1', 'localix://resource/fake/root/leaf')).toEqual({
      ok: true,
      content: 'LEAF CONTENT',
      language: 'sql',
    })
    const miss = await reg.expand('u1', 'localix://resource/other/x')
    expect(miss.ok).toBe(false)
    expect(miss.error).toContain('no resource provider')
  })

  it('unknown parent provider returns no children (never throws)', async () => {
    const reg = createResourceProviderRegistry()
    expect(await reg.listChildren('u1', 'localix://resource/ghost/x')).toEqual([])
  })

  it('isolates a throwing provider at BOTH root and drill level (empty listing, never throws)', async () => {
    const broken: ResourceRefProvider = {
      provider: 'boom',
      title: 'Broken',
      async listChildren() {
        throw new Error('backend down')
      },
      async expand() {
        return { ok: false, error: 'x' }
      },
    }
    const reg = createResourceProviderRegistry()
    reg.register(broken)
    reg.register(fakeProvider())
    // Roots: the healthy provider still lists; the broken one contributes [].
    const roots = await reg.listChildren('u1', null)
    expect(roots.map((n) => n.uri)).toEqual(['localix://resource/fake/root'])
    // Drill level: a throw is swallowed to [] (no route 500).
    expect(await reg.listChildren('u1', 'localix://resource/boom/anything')).toEqual([])
  })
})

describe('resource ref expansion pipeline', () => {
  const ref: ContextRef = {
    raw: '@resource:localix://resource/fake/root/leaf',
    kind: 'resource',
    uri: 'localix://resource/fake/root/leaf',
  }

  it('routes a resource ref through the injected loader with a language hint', async () => {
    const reg = createResourceProviderRegistry()
    reg.register(fakeProvider())
    const [exp] = await expandContextRefs('', [ref], {
      loadResource: hostLoader(reg),
    })
    expect(exp.ok).toBe(true)
    expect(exp.content).toBe('LEAF CONTENT')
    expect(exp.language).toBe('sql')
  })

  it('soft-fails when no resolver is wired', async () => {
    const [exp] = await expandContextRefs('', [ref], {})
    expect(exp.ok).toBe(false)
    expect(exp.error).toContain('not available')
  })

  // The composer chip PREVIEW flow: a typed/dragged token → parseContextRefs →
  // toWireRef (the wire payload) → expandContextRefs with the loader wired. Guards
  // the full parse→wire→expand contract: the `uri` must survive the wire mapping
  // (the preview bug dropped it) AND the loader must be injected (not-wired → FAIL).
  it('resolves ok:true end-to-end through the preview wire path', async () => {
    const reg = createResourceProviderRegistry()
    reg.register(fakeProvider())
    const wire = parseContextRefs('@resource:localix://resource/fake/root/leaf').map(toWireRef)
    expect(wire[0].uri).toBe('localix://resource/fake/root/leaf') // survived the wire mapping
    const [exp] = await expandContextRefs('', wire, { loadResource: hostLoader(reg) })
    expect(exp.ok).toBe(true)
    expect(exp.content).toBe('LEAF CONTENT')
  })

  it('soft-fails a bad node uri with the provider error', async () => {
    const reg = createResourceProviderRegistry()
    reg.register(fakeProvider())
    const bad: ContextRef = {
      raw: '@resource:localix://resource/fake/nope',
      kind: 'resource',
      uri: 'localix://resource/fake/nope',
    }
    const [exp] = await expandContextRefs('', [bad], { loadResource: hostLoader(reg) })
    expect(exp.ok).toBe(false)
    expect(exp.error).toBe('no such node')
  })
})
