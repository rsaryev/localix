import { describe, expect, test } from 'bun:test'
import { tempDirPerTest } from '@localixai/testing'
import { testLspServers } from '../plugins/kit/testing'
import { configuredLspServer } from './lsp-plugin-servers'

const dir = tempDirPerTest('lsp-plugin-servers')

async function serverOf(raw: Record<string, unknown>) {
  const { servers } = await testLspServers(dir(), { s: raw })
  return servers[0]!
}

describe('configuredLspServer', () => {
  test('handles the extensions it declares, lowercase and once, rooted at the project', async () => {
    // clangd-lsp (the official marketplace) maps `.C` and `.H` beside `.c`.
    const def = configuredLspServer(
      await serverOf({
        command: 'clangd',
        extensionToLanguage: { '.c': 'c', '.cpp': 'cpp', '.C': 'cpp', '.H': 'cpp' },
      }),
    )
    expect(def.id).toBe('lsp-p@test:s')
    expect(def.extensions.toSorted()).toEqual(['.c', '.cpp', '.h'])
    expect(def.resolveRoot('/proj/src/main.c', '/proj')).toBe('/proj')
  })

  test('spawn yields undefined when the binary is not on PATH (graceful)', async () => {
    const def = configuredLspServer(
      await serverOf({
        command: 'definitely-not-a-real-binary-xyz',
        extensionToLanguage: { '.rs': 'rust' },
      }),
    )
    expect(await def.spawn('/tmp', '/tmp')).toBeUndefined()
  })
})
