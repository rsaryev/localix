import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getServersForExtension,
  getServersForFile,
  resolveTypeScriptRoot,
  typescriptInitialization,
  VTSLS_MAX_TS_SERVER_MEMORY_MB,
} from './lsp-servers'

let tempRoot: string | undefined
afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  tempRoot = undefined
})

describe('TypeScript server resource bounds', () => {
  test('one workspace lockfile collapses package roots onto one vtsls process', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'localix-lsp-root-'))
    await writeFile(join(tempRoot, 'bun.lock'), '')
    const api = join(tempRoot, 'apps', 'api')
    const ui = join(tempRoot, 'apps', 'ui')
    await mkdir(api, { recursive: true })
    await mkdir(ui, { recursive: true })
    await writeFile(join(api, 'package.json'), '{}')
    await writeFile(join(ui, 'package.json'), '{}')

    expect(resolveTypeScriptRoot(join(api, 'src', 'a.ts'), tempRoot)).toBe(tempRoot)
    expect(resolveTypeScriptRoot(join(ui, 'src', 'b.tsx'), tempRoot)).toBe(tempRoot)
  })

  test('a standalone package stays its own root and tsserver has a hard memory ceiling', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'localix-lsp-package-'))
    await writeFile(join(tempRoot, 'package.json'), '{}')
    expect(resolveTypeScriptRoot(join(tempRoot, 'src', 'a.ts'), tempRoot)).toBe(tempRoot)
    expect(typescriptInitialization('/typescript/lib')).toMatchObject({
      typescript: {
        tsdk: '/typescript/lib',
        tsserver: { maxTsServerMemory: VTSLS_MAX_TS_SERVER_MEMORY_MB },
      },
    })
    expect(VTSLS_MAX_TS_SERVER_MEMORY_MB).toBeLessThan(3072)
  })
})

describe('getServersForFile', () => {
  test('matches by extension', () => {
    expect(getServersForFile('a/b/x.json').map((s) => s.id)).toEqual(['json'])
    expect(getServersForFile('conf.yaml').map((s) => s.id)).toEqual(['yaml'])
    expect(getServersForFile('a.css').map((s) => s.id)).toEqual(['css'])
  })
  test('matches Dockerfile by FILENAME (no extension)', () => {
    expect(getServersForFile('Dockerfile').map((s) => s.id)).toEqual(['dockerfile'])
    expect(getServersForFile('docker/Dockerfile.dev').map((s) => s.id)).toEqual(['dockerfile'])
    expect(getServersForFile('api.dockerfile').map((s) => s.id)).toEqual(['dockerfile'])
  })
  test('unknown file → no servers', () => {
    expect(getServersForFile('notes.xyz')).toEqual([])
    expect(getServersForFile('README')).toEqual([])
  })
})

describe('getServersForExtension', () => {
  test('an extension claimed by multiple servers returns all of them', () => {
    // .ts is handled by both the TypeScript and Deno language servers.
    expect(
      getServersForExtension('.ts')
        .map((s) => s.id)
        .sort(),
    ).toEqual(['deno', 'typescript'])
  })

  test('single-server extensions map to their one server', () => {
    expect(getServersForExtension('.py').map((s) => s.id)).toEqual(['python'])
    expect(getServersForExtension('.rs').map((s) => s.id)).toEqual(['rust'])
    expect(getServersForExtension('.go').map((s) => s.id)).toEqual(['go'])
    expect(getServersForExtension('.vue').map((s) => s.id)).toEqual(['vue'])
  })

  test('an unknown extension yields no servers', () => {
    expect(getServersForExtension('.zig')).toEqual([])
  })

  test('the extension must include the leading dot (table is matched exactly)', () => {
    // A caller passing a bare extension gets nothing — a real gotcha.
    expect(getServersForExtension('ts')).toEqual([])
  })
})
