import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { tools } from './kit-tools'
import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'

const tempDir = tempDirPerTest('mini-app-kit-tools-')

const VALID = {
  name: 'gpu-monitor',
  version: '0.1.0',
  description: 'Watch the GPU.',
  apiVersion: 1,
  backend: './backend/index.ts',
}

describe('the kit’s manifest verdict', () => {
  test('a folder Localix would run has no errors', async () => {
    const dir = tempDir()
    writeTree(dir, { [MINI_APP_MANIFEST_FILE]: JSON.stringify(VALID), 'guide.md': '# Guide' })
    expect(await tools.manifest.validate(dir)).toEqual({
      name: 'gpu-monitor',
      errors: [],
      warnings: [],
    })
  })

  test('says what Localix’s discovery would refuse, in its words', async () => {
    const dir = tempDir()
    writeTree(dir, { [MINI_APP_MANIFEST_FILE]: JSON.stringify({ ...VALID, skills: './skills' }) })
    const verdict = await tools.manifest.validate(dir)
    expect(verdict.errors).toHaveLength(1)
    expect(verdict.errors[0]).toStartWith(`Invalid ${MINI_APP_MANIFEST_FILE}:`)
  })

  test('a plugin folder is not a mini app', async () => {
    const dir = tempDir()
    writeTree(dir, {
      [MINI_APP_MANIFEST_FILE]: JSON.stringify(VALID),
      '.claude-plugin/plugin.json': '{"name":"x"}',
    })
    expect((await tools.manifest.validate(dir)).errors.join('\n')).toContain('not both')
  })

  test('the host’s own checks speak too: duplicate views, a missing guide', async () => {
    const dir = tempDir()
    const view = { id: 'main', title: 'Main', file: './views/main.html' }
    writeTree(dir, { [MINI_APP_MANIFEST_FILE]: JSON.stringify({ ...VALID, views: [view, view] }) })
    const verdict = await tools.manifest.validate(dir)
    expect(verdict.errors.join('\n')).toContain('Duplicate view "main"')
    expect(verdict.warnings.join('\n')).toContain('No guide.md')
  })

  test('an app built for a newer Localix is refused', async () => {
    const dir = tempDir()
    writeTree(dir, { [MINI_APP_MANIFEST_FILE]: JSON.stringify({ ...VALID, apiVersion: 999 }) })
    expect((await tools.manifest.validate(dir)).errors.join('\n')).toContain('999')
  })
})

// The authoring plugin builds and signs a marketplace with these, so what it writes is what this
// Localix reads (`docs/extending/mini-app-marketplace.md`).
describe('the kit’s marketplace rules', () => {
  const written = {
    schema: 3,
    name: 'acme',
    owner: { name: 'Acme' },
    apps: [{ name: 'notes', source: './mini-apps/notes' }],
  }

  test('a marketplace as its keeper writes it passes; what Localix would refuse is said', () => {
    expect(tools.marketplace.problems(written, { curation: false })).toEqual([])
    expect(
      tools.marketplace
        .problems(
          { ...written, apps: [{ name: 'notes', featured: true, source: './mini-apps/notes' }] },
          { curation: false },
        )
        .join('\n'),
    ).toContain('only the Localix marketplace curates')
  })

  test('a release it signs is read and verified as Localix reads and verifies it', () => {
    const key = generateKeyPairSync('ed25519').privateKey
    const released = {
      ...written,
      published: '2026-10-30T09:00:00.000Z',
      signingKeys: [tools.marketplace.publicKeyOf(key)],
      apps: [
        {
          name: 'notes',
          source: {
            source: 'archive',
            url: 'notes-1.0.0.tar.gz',
            bytes: 10,
            sha256: 'a'.repeat(64),
          },
        },
      ],
    }
    const bytes = new TextEncoder().encode(JSON.stringify(released))
    const signature = tools.marketplace.sign(bytes, [key])
    expect(tools.marketplace.verify(bytes, signature)).toEqual({
      keys: [tools.marketplace.publicKeyOf(key)],
    })
    const read = tools.marketplace.read(released)
    expect(read.kind === 'marketplace' && read.marketplace.apps.map((app) => app.name)).toEqual([
      'notes',
    ])
    expect(tools.marketplace.releaseFile).toBe('mini-app-marketplace.json')
    expect(tools.marketplace.file).toBe('.localix-mini-app/marketplace.json')
  })
})

test('the tailwind compiler builds utilities against the stylesheet it is given', async () => {
  const compiler = await tools.compileTailwind(
    '@theme { --color-brand: #f00; } @tailwind utilities;',
    {
      base: '/',
      loadStylesheet: async () => {
        throw new Error('no imports here')
      },
      loadModule: async () => {
        throw new Error('no modules here')
      },
    },
  )
  expect(compiler.build(['text-brand'])).toContain('.text-brand')
})
