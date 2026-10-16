import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { resolveEntrypoints } from './discovery-entrypoints'
import { loadManifest } from './manifest-load'
import type { PluginManifest } from './contracts'
import {
  synthesizeEntryManifest,
  mergeEntryOverrides,
  entryHasComponents,
  applyEntryManifestOverrides,
} from './marketplace-entry-manifest'
import type { MarketplaceEntry } from './marketplace'

const manifest = (extra: Partial<PluginManifest>): PluginManifest =>
  ({ name: 'p', version: '1.0.0', description: '', ...extra }) as PluginManifest

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'cc-parity-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

// ---- A: manifest `hooks` field ------------------------------------------------

describe('resolveEntrypoints — manifest hooks field (Part A)', () => {
  const inlineBlock = {
    hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] },
  }

  it('resolves an INLINE hooks object', async () => {
    const r = await resolveEntrypoints(dir, manifest({ hooks: inlineBlock as never }))
    expect(r.hookConfigs).toEqual([inlineBlock])
  })

  it('resolves a STRING path to a hooks-json file', async () => {
    await fs.writeFile(join(dir, 'my-hooks.json'), JSON.stringify(inlineBlock))
    const r = await resolveEntrypoints(dir, manifest({ hooks: './my-hooks.json' }))
    expect(r.hookConfigs).toEqual([inlineBlock])
  })

  it('resolves an ARRAY of hook-file paths (in order)', async () => {
    const a = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'a' }] }] } }
    const b = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'b' }] }] } }
    await fs.writeFile(join(dir, 'a.json'), JSON.stringify(a))
    await fs.writeFile(join(dir, 'b.json'), JSON.stringify(b))
    const r = await resolveEntrypoints(dir, manifest({ hooks: ['./a.json', './b.json'] }))
    expect(r.hookConfigs).toEqual([a, b])
  })

  it('falls back to the default hooks/hooks.json when the field is absent', async () => {
    await fs.mkdir(join(dir, 'hooks'), { recursive: true })
    await fs.writeFile(join(dir, 'hooks', 'hooks.json'), JSON.stringify(inlineBlock))
    const r = await resolveEntrypoints(dir, manifest({}))
    expect(r.hookConfigs).toEqual([inlineBlock])
  })

  it('the manifest field REPLACES the default file (mirrors mcpServers)', async () => {
    await fs.mkdir(join(dir, 'hooks'), { recursive: true })
    await fs.writeFile(join(dir, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { Stop: [] } }))
    const r = await resolveEntrypoints(dir, manifest({ hooks: inlineBlock as never }))
    expect(r.hookConfigs).toEqual([inlineBlock])
  })

  it('a `..`-escaping path is dropped (confined to the plugin dir)', async () => {
    const r = await resolveEntrypoints(dir, manifest({ hooks: '../evil.json' }))
    expect(r.hookConfigs).toEqual([])
  })
})

// ---- C: manifest `lspServers` field -------------------------------------------

describe('resolveEntrypoints — manifest lspServers field (Part C)', () => {
  const rust = {
    'rust-analyzer': { command: 'rust-analyzer', extensionToLanguage: { '.rs': 'rust' } },
  }

  it('resolves an INLINE lspServers map', async () => {
    const r = await resolveEntrypoints(dir, manifest({ lspServers: rust as never }))
    expect(r.lspServers).toEqual(rust)
  })

  it('resolves a STRING path to a .lsp.json file (unwraps a {lspServers} wrapper)', async () => {
    await fs.writeFile(join(dir, 'servers.json'), JSON.stringify({ lspServers: rust }))
    const r = await resolveEntrypoints(dir, manifest({ lspServers: './servers.json' }))
    expect(r.lspServers).toEqual(rust)
  })

  it('falls back to the default .lsp.json when the field is absent', async () => {
    await fs.writeFile(join(dir, '.lsp.json'), JSON.stringify(rust))
    const r = await resolveEntrypoints(dir, manifest({}))
    expect(r.lspServers).toEqual(rust)
  })
})

// ---- B: strict:false entry-as-manifest ---------------------------------------

describe('marketplace entry-as-manifest synthesis (Part B)', () => {
  it('entryHasComponents detects inline skills / lspServers', () => {
    expect(entryHasComponents({ name: 'x', source: './x' } as MarketplaceEntry)).toBe(false)
    expect(
      entryHasComponents({
        name: 'x',
        source: './x',
        skills: ['./skills/box'],
      } as MarketplaceEntry),
    ).toBe(true)
    expect(
      entryHasComponents({ name: 'x', source: './x', lspServers: {} } as MarketplaceEntry),
    ).toBe(true)
  })

  it('synthesizes a manifest from a box-style skill-bundle entry', () => {
    const entry = {
      name: 'box',
      description: 'Box content',
      source: { source: 'url', url: 'https://github.com/box/box-for-ai.git', sha: 'abc' },
      skills: ['./skills/box', './skills/box-legal-workflows'],
    } as unknown as MarketplaceEntry
    expect(synthesizeEntryManifest(entry)).toEqual({
      name: 'box',
      description: 'Box content',
      skills: ['./skills/box', './skills/box-legal-workflows'],
    })
  })

  it('synthesizes a manifest from a strict:false LSP entry (clangd)', () => {
    const entry = {
      name: 'clangd-lsp',
      version: '1.0.0',
      source: './plugins/clangd-lsp',
      strict: false,
      lspServers: { clangd: { command: 'clangd', extensionToLanguage: { '.c': 'c' } } },
    } as unknown as MarketplaceEntry
    expect(synthesizeEntryManifest(entry)).toEqual({
      name: 'clangd-lsp',
      version: '1.0.0',
      lspServers: { clangd: { command: 'clangd', extensionToLanguage: { '.c': 'c' } } },
    })
  })

  it('mergeEntryOverrides unions skills and never overwrites the manifest authority', () => {
    const merged = mergeEntryOverrides(
      { name: 'p', skills: ['./skills/a'], lspServers: { x: { command: 'x' } } },
      {
        name: 'p',
        source: './p',
        skills: ['./skills/a', './skills/b'],
        lspServers: { x: { command: 'OTHER' }, y: { command: 'y' } },
      } as unknown as MarketplaceEntry,
    )
    expect(merged.skills).toEqual(['./skills/a', './skills/b'])
    // existing lspServers.x wins; new y is added.
    expect(merged.lspServers).toEqual({ x: { command: 'x' }, y: { command: 'y' } })
  })

  it('entry version OVERRIDES the manifest version (CC: "overrides plugin.json")', () => {
    const merged = mergeEntryOverrides({ name: 'p', version: '1.0.0' }, {
      name: 'p',
      source: './p',
      version: '2.0.0',
    } as unknown as MarketplaceEntry)
    expect(merged.version).toBe('2.0.0')
  })

  it('entry displayName/description only FILL GAPS — the manifest keeps its own', () => {
    const filled = mergeEntryOverrides({ name: 'p' }, {
      name: 'p',
      source: './p',
      displayName: 'Pretty P',
      description: 'from entry',
    } as unknown as MarketplaceEntry)
    expect(filled.displayName).toBe('Pretty P')
    expect(filled.description).toBe('from entry')

    const kept = mergeEntryOverrides(
      { name: 'p', displayName: 'Own Name', description: 'own desc' },
      {
        name: 'p',
        source: './p',
        displayName: 'Entry Name',
        description: 'entry desc',
      } as unknown as MarketplaceEntry,
    )
    expect(kept.displayName).toBe('Own Name')
    expect(kept.description).toBe('own desc')
  })

  it('a metadata-only entry (no components) still lands on the installed plugin.json', async () => {
    // Regression: the old gate no-opped unless the entry had COMPONENT fields, so a
    // strict entry carrying only a version override never reached the manifest.
    await fs.writeFile(
      join(dir, 'plugin.json'),
      JSON.stringify({ name: 'p', version: '1.0.0', description: 'own desc' }),
    )
    const entry = {
      name: 'p',
      source: './p',
      version: '3.1.4',
      description: 'entry desc',
    } as unknown as MarketplaceEntry
    await applyEntryManifestOverrides(dir, entry)
    const written = JSON.parse(await fs.readFile(join(dir, 'plugin.json'), 'utf8'))
    expect(written.version).toBe('3.1.4') // entry overrides
    expect(written.description).toBe('own desc') // manifest keeps its own
  })

  it('synthesizes displayName onto an entry-as-manifest', () => {
    const entry = {
      name: 'x',
      source: './x',
      displayName: 'Pretty X',
      skills: ['./skills/x'],
    } as unknown as MarketplaceEntry
    expect(synthesizeEntryManifest(entry)).toEqual({
      name: 'x',
      displayName: 'Pretty X',
      skills: ['./skills/x'],
    })
  })

  it('end-to-end: installing a box-style entry (no plugin.json) exposes the skills', async () => {
    // Simulate a freshly-copied plugin dir: skills present, but NO plugin.json.
    await fs.mkdir(join(dir, 'skills', 'box'), { recursive: true })
    await fs.writeFile(
      join(dir, 'skills', 'box', 'SKILL.md'),
      '---\nname: box\ndescription: Work with Box\n---\nBody\n',
    )
    const entry = {
      name: 'box',
      source: { source: 'url', url: 'https://x/y.git', sha: 'abc' },
      skills: ['./skills/box'],
    } as unknown as MarketplaceEntry

    await applyEntryManifestOverrides(dir, entry)

    // A Claude-format plugin.json was synthesized...
    const written = JSON.parse(
      await fs.readFile(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'),
    )
    expect(written).toEqual({ name: 'box', skills: ['./skills/box'] })
    // ...and discovery now exposes the skill.
    const plugin = await loadManifest(dir, 'global', '')
    expect(plugin.error).toBeUndefined()
    expect(plugin.provides.skills).toContain('box')
  })

  it('end-to-end: a strict:false LSP entry synthesizes lspServers onto the record', async () => {
    // The *-lsp plugin dirs ship only LICENSE+README — no plugin.json.
    await fs.writeFile(join(dir, 'LICENSE'), 'MIT')
    const entry = {
      name: 'rust-analyzer-lsp',
      source: './plugins/rust-analyzer-lsp',
      strict: false,
      lspServers: {
        'rust-analyzer': { command: 'rust-analyzer', extensionToLanguage: { '.rs': 'rust' } },
      },
    } as unknown as MarketplaceEntry

    await applyEntryManifestOverrides(dir, entry)
    const plugin = await loadManifest(dir, 'global', '')
    expect(plugin.error).toBeUndefined()
    expect(plugin.provides.lspServers).toEqual(['rust-analyzer'])
  })

  it('supplements an existing plugin.json without clobbering its own skills', async () => {
    await fs.writeFile(
      join(dir, 'plugin.json'),
      JSON.stringify({ name: 'box', skills: ['./skills/own'] }),
    )
    const entry = {
      name: 'box',
      source: './box',
      skills: ['./skills/own', './skills/extra'],
    } as unknown as MarketplaceEntry
    await applyEntryManifestOverrides(dir, entry)
    const written = JSON.parse(await fs.readFile(join(dir, 'plugin.json'), 'utf8'))
    expect(written.skills).toEqual(['./skills/own', './skills/extra'])
  })

  it('is a no-op when the entry declares no components', async () => {
    const entry = { name: 'x', source: './x' } as MarketplaceEntry
    await applyEntryManifestOverrides(dir, entry)
    expect(fs.access(join(dir, '.claude-plugin', 'plugin.json'))).rejects.toThrow()
  })
})
