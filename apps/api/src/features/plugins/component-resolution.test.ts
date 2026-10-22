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

  it('the manifest field MERGES with the default file, which loads first (Claude Code)', async () => {
    await fs.mkdir(join(dir, 'hooks'), { recursive: true })
    await fs.writeFile(join(dir, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { Stop: [] } }))
    const r = await resolveEntrypoints(dir, manifest({ hooks: inlineBlock as never }))
    expect(r.hookConfigs).toEqual([{ hooks: { Stop: [] } }, inlineBlock])
  })

  it('MCP and LSP sources merge the same way: the default file, then the listed ones', async () => {
    await fs.writeFile(
      join(dir, '.mcp.json'),
      JSON.stringify({ mcpServers: { a: { command: 'a' } } }),
    )
    await fs.writeFile(join(dir, 'more.mcp.json'), JSON.stringify({ b: { command: 'b' } }))
    const r = await resolveEntrypoints(
      dir,
      manifest({ mcpServers: ['./more.mcp.json', { c: { command: 'c' } }] as never }),
    )
    expect(Object.keys(r.mcpServers)).toEqual(['a', 'b', 'c'])
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

  it('mergeEntryOverrides appends skills; entry servers do not apply over a plugin.json', () => {
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
    // Claude Code: entry mcpServers/lspServers apply only when the entry IS the manifest.
    expect(merged.lspServers).toEqual({ x: { command: 'x' } })
  })

  it('the plugin.json version wins over the entry version (Claude Code)', () => {
    const merged = mergeEntryOverrides({ name: 'p', version: '1.0.0' }, {
      name: 'p',
      source: './p',
      version: '2.0.0',
    } as unknown as MarketplaceEntry)
    expect(merged.version).toBe('1.0.0')
    const filled = mergeEntryOverrides({ name: 'p' }, {
      name: 'p',
      source: './p',
      version: '2.0.0',
    } as unknown as MarketplaceEntry)
    expect(filled.version).toBe('2.0.0')
  })

  it('entry display fields win over plugin.json (Claude Code)', () => {
    const merged = mergeEntryOverrides(
      { name: 'p', displayName: 'Own Name', description: 'own desc', license: 'MIT' },
      {
        name: 'p',
        source: './p',
        displayName: 'Entry Name',
        description: 'entry desc',
      } as unknown as MarketplaceEntry,
    )
    expect(merged.displayName).toBe('Entry Name')
    expect(merged.description).toBe('entry desc')
    expect(merged.license).toBe('MIT')
  })

  it('a strict:false entry with components conflicts with a plugin.json', () => {
    expect(() =>
      mergeEntryOverrides({ name: 'p' }, {
        name: 'p',
        source: './p',
        strict: false,
        skills: ['./skills/b'],
      } as unknown as MarketplaceEntry),
    ).toThrow('has conflicting manifests')
    // Without components, strict:false leaves plugin.json the manifest.
    expect(
      mergeEntryOverrides({ name: 'p', version: '1.0.0' }, {
        name: 'p',
        source: './p',
        strict: false,
        description: 'd',
      } as unknown as MarketplaceEntry),
    ).toEqual({ name: 'p', version: '1.0.0', description: 'd' })
  })

  it('entry hooks replace the manifest matchers per event; a hooks path is refused', () => {
    const stop = [{ hooks: [{ type: 'command', command: 'entry' }] }]
    const merged = mergeEntryOverrides({ name: 'p', hooks: { Stop: [], PreToolUse: [] } }, {
      name: 'p',
      source: './p',
      hooks: { Stop: stop },
    } as unknown as MarketplaceEntry)
    expect(merged.hooks).toEqual({ Stop: stop, PreToolUse: [] })
    expect(() =>
      synthesizeEntryManifest({
        name: 'p',
        source: './p',
        hooks: './hooks.json',
      } as unknown as MarketplaceEntry),
    ).toThrow('not yet supported in a marketplace entry')
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
    expect(written.version).toBe('1.0.0') // plugin.json's version wins
    expect(written.description).toBe('entry desc') // the entry's display field wins
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

    // The plugin's own Claude Code manifest was synthesized...
    const written = JSON.parse(await fs.readFile(join(dir, '.claude-plugin/plugin.json'), 'utf8'))
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
    expect(fs.access(join(dir, 'plugin.json'))).rejects.toThrow()
  })
})
