import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'
import type { MessageContextBinding } from '@localixai/agent'

import { captureContextBindings } from './binding-capture'
import { createHostRefResolver, type HostRefExpander } from './host-ref-resolver'
import { createContextManager } from './manager'
import { createContextProviderRegistry } from './registry'

/**
 * The send path end to end through REAL Fabric parts: registry, manager, admission policy and the
 * host-reference resolver. Only the expander (the filesystem/digest reads) is a fake.
 */

function binding(
  id: string,
  target: Partial<MessageContextBinding['target']> & { kind: string },
): MessageContextBinding {
  return {
    kind: 'context',
    id,
    source: 'mention',
    target: { token: `@${target.kind}:${id}`, label: id, ...target },
    resolution: { status: 'pending', contributions: [] },
  }
}

function fabric(expand: HostRefExpander) {
  const registry = createContextProviderRegistry()
  registry.register({
    provider: createHostRefResolver(expand),
    destinations: ['chat'],
    activation: 'explicit',
    defaultEnabled: true,
    maxTokens: 100_000,
    timeoutMs: 1_000,
    sensitivity: 'project',
  })
  return createContextManager(registry)
}

const echo: HostRefExpander = async (_userId, input) =>
  input.refs.map((ref) => ({
    raw: ref.raw,
    ok: true,
    content: ref.kind === 'snippet' ? (ref.content ?? '') : `body of ${ref.path ?? ref.raw}`,
    chars: 1,
  }))

async function capture(
  expand: HostRefExpander,
  bindings: MessageContextBinding[],
  extra: Partial<Parameters<typeof captureContextBindings>[1]> = {},
) {
  return captureContextBindings(
    fabric(expand),
    {
      userId: 'u',
      session: { id: 's', projectId: null },
      bindings,
      maxBytes: 100_000,
      capturedAt: '2026-09-30T00:00:00.000Z',
      ...extra,
    },
    new AbortController().signal,
  )
}

describe('captureContextBindings', () => {
  test('two chips with the same token resolve one-to-one by binding id', async () => {
    const snippet = (id: string, content: string) =>
      binding(id, { kind: 'snippet', token: '@snippet:Output', attributes: { content } })
    const result = await capture(echo, [snippet('a', 'first'), snippet('b', 'second')])
    expect(result.get('a')?.contributions[0]?.content).toContain('first')
    expect(result.get('b')?.contributions[0]?.content).toContain('second')
  })

  test('attributes reach the expander without a hand-copied field list', async () => {
    const seen: unknown[] = []
    await capture(
      async (userId, input) => {
        seen.push(...input.refs)
        return echo(userId, input)
      },
      [binding('m', { kind: 'message', attributes: { sessionId: 's', messageId: 'm1' } })],
    )
    expect(seen).toEqual([expect.objectContaining({ kind: 'message', messageId: 'm1' })])
  })

  test('a secret-shaped snippet is withheld by the same policy as a provider, and named', async () => {
    const result = await capture(echo, [
      binding('k', {
        kind: 'snippet',
        attributes: { content: '-----BEGIN RSA PRIVATE KEY-----\nMIIE' },
      }),
    ])
    expect(result.get('k')?.status).toBe('denied')
    expect(result.get('k')?.contributions).toEqual([
      expect.objectContaining({
        kind: 'unavailable',
        content: expect.stringContaining('withheld'),
      }),
    ])
  })

  test('a failed read resolves to its reason and is reported as an error', async () => {
    const result = await capture(
      async (_userId, input) =>
        input.refs.map((ref) => ({ raw: ref.raw, ok: false, error: 'not found', chars: 0 })),
      [binding('f', { kind: 'file', attributes: { path: 'gone.ts' } })],
      { workspace: { rootPath: tmpdir() } },
    )
    expect(result.get('f')?.status).toBe('error')
    expect(result.get('f')?.contributions[0]?.content).toContain('not found')
  })

  test('a kind nothing resolves is named in the turn, not dropped', async () => {
    const result = await capture(echo, [binding('x', { kind: 'unknown-widget' })])
    expect(result.get('x')?.status).toBe('unsupported')
    expect(result.get('x')?.contributions[0]?.content).toContain('@unknown-widget:x: not included')
  })

  test("a linked file honours the workspace's exclusions", async () => {
    const root = await mkdtemp(join(tmpdir(), 'binding-capture-'))
    await mkdir(join(root, 'private'))
    await writeFile(join(root, 'private', 'notes.md'), 'x')
    await writeFile(join(root, 'open.md'), 'x')
    const result = await capture(
      echo,
      [
        binding('p', { kind: 'file', attributes: { path: 'private/notes.md' } }),
        binding('o', { kind: 'file', attributes: { path: 'open.md' } }),
      ],
      { workspace: { rootPath: root, excludedRelativePaths: ['private'] } },
    )
    expect(result.get('p')?.status).toBe('denied')
    expect(result.get('o')?.status).toBe('resolved')
  })

  test('a binding past the turn budget says the budget was full', async () => {
    const big = 'y'.repeat(600)
    const result = await capture(
      echo,
      [
        binding('1', { kind: 'snippet', attributes: { content: big } }),
        binding('2', { kind: 'snippet', attributes: { content: big } }),
      ],
      { maxBytes: 900 },
    )
    expect(result.get('1')?.status).toBe('resolved')
    expect(result.get('2')?.contributions[0]?.content).toContain('budget was already full')
  })
})
