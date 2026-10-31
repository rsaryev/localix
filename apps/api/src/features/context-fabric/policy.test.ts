import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createContextPolicy } from './policy'
import type { ContextContribution, ResolveContext } from '@localixai/mini-app-sdk/backend'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const item = (source?: string, content = 'const safe = true'): ContextContribution => ({
  id: 'x',
  providerId: 'p',
  providerVersion: '1',
  scope: 'project',
  kind: 'code',
  content,
  source: source ? { path: source } : undefined,
  priority: 1,
  sensitivity: 'project',
})
const request = (root?: string): ResolveContext => ({
  destination: 'edit-prediction',
  userId: 'u',
  maxBytes: 1000,
  workspace: root ? { rootPath: root } : undefined,
})

describe('Context Fabric canonical filesystem policy', () => {
  test('admits canonical in-root source and rejects symlink escape and secret files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fabric-root-'))
    roots.push(root)
    const outside = await mkdtemp(join(tmpdir(), 'fabric-outside-'))
    roots.push(outside)
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'a.ts'), 'safe')
    await writeFile(join(outside, 'secret.ts'), 'unsafe')
    await symlink(join(outside, 'secret.ts'), join(root, 'src', 'escape.ts'))
    await writeFile(join(root, '.env'), 'X=1')
    const policy = createContextPolicy()
    const signal = new AbortController().signal
    expect(policy.admit(item(join(root, 'src', 'a.ts')), request(root), signal)).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        contribution: expect.objectContaining({
          source: { path: await realpath(join(root, 'src', 'a.ts')) },
        }),
      }),
    )
    expect(
      policy.admit(item(join(root, 'src', 'escape.ts')), request(root), signal),
    ).resolves.toEqual({ ok: false, reason: 'excluded_uri' })
    expect(policy.admit(item(join(root, '.env')), request(root), signal)).resolves.toEqual({
      ok: false,
      reason: 'excluded_uri',
    })
  })

  test('applies configured root-relative exclusions without weakening fixed deny rules', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fabric-config-'))
    roots.push(root)
    await mkdir(join(root, 'generated'))
    await writeFile(join(root, 'generated', 'types.ts'), 'safe')
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'safe.ts'), 'safe')
    const policy = createContextPolicy()
    const signal = new AbortController().signal
    const configured = {
      ...request(root),
      workspace: { rootPath: root, excludedRelativePaths: ['generated'] },
    }
    expect(
      policy.admit(item(join(root, 'generated', 'types.ts')), configured, signal),
    ).resolves.toEqual({ ok: false, reason: 'excluded_uri' })
    expect(policy.admit(item(join(root, 'src', 'safe.ts')), configured, signal)).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    )
  })

  test('fails closed for unresolved filesystem provenance but leaves opaque resources provider-owned', () => {
    const policy = createContextPolicy()
    const signal = new AbortController().signal
    expect(
      policy.admit(item('/missing/file.ts'), request('/missing/root'), signal),
    ).resolves.toEqual({ ok: false, reason: 'path_unresolved' })
    expect(
      policy.admit(
        { ...item(), uri: 'localix://resource/fixture-db/connection/table' },
        request(),
        signal,
      ),
    ).resolves.toEqual(expect.objectContaining({ ok: true }))
    expect(
      policy.admit(item(undefined, 'token = "0123456789abcdef"'), request(), signal),
    ).resolves.toEqual({ ok: false, reason: 'secret' })
  })
})
