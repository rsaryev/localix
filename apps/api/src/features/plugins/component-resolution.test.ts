import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { loadManifest } from './manifest-load'
import {
  synthesizeEntryManifest,
  mergeEntryOverrides,
  entryHasComponents,
  applyEntryManifestOverrides,
} from './marketplace-entry-manifest'
import { kitEntry } from './kit/testing'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'cc-parity-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('marketplace entry-as-manifest synthesis (Part B)', () => {
  it('entryHasComponents detects inline skills / lspServers', () => {
    expect(entryHasComponents(kitEntry({ name: 'x', source: './x' }))).toBe(false)
    expect(
      entryHasComponents(
        kitEntry({
          name: 'x',
          source: './x',
          skills: ['./skills/box'],
        }),
      ),
    ).toBe(true)
    expect(entryHasComponents(kitEntry({ name: 'x', source: './x', lspServers: {} }))).toBe(true)
  })

  it('synthesizes a manifest from a box-style skill-bundle entry', () => {
    const entry = kitEntry({
      name: 'box',
      description: 'Box content',
      source: { source: 'url', url: 'https://github.com/box/box-for-ai.git', sha: 'c'.repeat(40) },
      skills: ['./skills/box', './skills/box-legal-workflows'],
    })
    expect(synthesizeEntryManifest(entry)).toEqual({
      name: 'box',
      description: 'Box content',
      skills: ['./skills/box', './skills/box-legal-workflows'],
    })
  })

  it('synthesizes a manifest from a strict:false LSP entry (clangd)', () => {
    const entry = kitEntry({
      name: 'clangd-lsp',
      version: '1.0.0',
      source: './plugins/clangd-lsp',
      strict: false,
      lspServers: { clangd: { command: 'clangd', extensionToLanguage: { '.c': 'c' } } },
    })
    expect(synthesizeEntryManifest(entry)).toEqual({
      name: 'clangd-lsp',
      version: '1.0.0',
      lspServers: { clangd: { command: 'clangd', extensionToLanguage: { '.c': 'c' } } },
    })
  })

  it('mergeEntryOverrides appends skills; entry servers do not apply over a plugin.json', () => {
    const merged = mergeEntryOverrides(
      { name: 'p', skills: ['./skills/a'], lspServers: { x: { command: 'x' } } },
      kitEntry({
        name: 'p',
        source: './p',
        skills: ['./skills/a', './skills/b'],
        lspServers: { x: { command: 'OTHER' }, y: { command: 'y' } },
      }),
    )
    expect(merged.skills).toEqual(['./skills/a', './skills/b'])
    // Claude Code: entry mcpServers/lspServers apply only when the entry IS the manifest.
    expect(merged.lspServers).toEqual({ x: { command: 'x' } })
  })

  it('the plugin.json version wins over the entry version (Claude Code)', () => {
    const merged = mergeEntryOverrides(
      { name: 'p', version: '1.0.0' },
      kitEntry({
        name: 'p',
        source: './p',
        version: '2.0.0',
      }),
    )
    expect(merged.version).toBe('1.0.0')
    const filled = mergeEntryOverrides(
      { name: 'p' },
      kitEntry({
        name: 'p',
        source: './p',
        version: '2.0.0',
      }),
    )
    expect(filled.version).toBe('2.0.0')
  })

  it('entry display fields win over plugin.json (Claude Code)', () => {
    const merged = mergeEntryOverrides(
      { name: 'p', displayName: 'Own Name', description: 'own desc', license: 'MIT' },
      kitEntry({
        name: 'p',
        source: './p',
        displayName: 'Entry Name',
        description: 'entry desc',
      }),
    )
    expect(merged.displayName).toBe('Entry Name')
    expect(merged.description).toBe('entry desc')
    expect(merged.license).toBe('MIT')
  })

  it('a strict:false entry with components conflicts with a plugin.json', () => {
    expect(() =>
      mergeEntryOverrides(
        { name: 'p' },
        kitEntry({
          name: 'p',
          source: './p',
          strict: false,
          skills: ['./skills/b'],
        }),
      ),
    ).toThrow('has conflicting manifests')
    // Without components, strict:false leaves plugin.json the manifest.
    expect(
      mergeEntryOverrides(
        { name: 'p', version: '1.0.0' },
        kitEntry({
          name: 'p',
          source: './p',
          strict: false,
          description: 'd',
        }),
      ),
    ).toEqual({ name: 'p', version: '1.0.0', description: 'd' })
  })

  it('entry hooks replace the manifest matchers per event; a hooks path is refused', () => {
    const stop = [{ hooks: [{ type: 'command', command: 'entry' }] }]
    const merged = mergeEntryOverrides(
      { name: 'p', hooks: { Stop: [], PreToolUse: [] } },
      kitEntry({
        name: 'p',
        source: './p',
        hooks: { Stop: stop },
      }),
    )
    expect(merged.hooks).toEqual({ Stop: stop, PreToolUse: [] })
    expect(() =>
      synthesizeEntryManifest(
        kitEntry({
          name: 'p',
          source: './p',
          hooks: './hooks.json',
        }),
      ),
    ).toThrow('not yet supported in a marketplace entry')
  })

  it('a metadata-only entry (no components) still lands on the installed plugin.json', async () => {
    // Regression: the old gate no-opped unless the entry had COMPONENT fields, so a
    // strict entry carrying only a version override never reached the manifest.
    await fs.mkdir(join(dir, '.claude-plugin'), { recursive: true })
    await fs.writeFile(
      join(dir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'p', version: '1.0.0', description: 'own desc' }),
    )
    const entry = kitEntry({
      name: 'p',
      source: './p',
      version: '3.1.4',
      description: 'entry desc',
    })
    await applyEntryManifestOverrides(dir, entry)
    const written = JSON.parse(
      await fs.readFile(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'),
    )
    expect(written.version).toBe('1.0.0') // plugin.json's version wins
    expect(written.description).toBe('entry desc') // the entry's display field wins
  })

  it('synthesizes displayName onto an entry-as-manifest', () => {
    const entry = kitEntry({
      name: 'x',
      source: './x',
      displayName: 'Pretty X',
      skills: ['./skills/x'],
    })
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
    const entry = kitEntry({
      name: 'box',
      source: { source: 'url', url: 'https://x/y.git', sha: 'c'.repeat(40) },
      skills: ['./skills/box'],
    })

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
    const entry = kitEntry({
      name: 'rust-analyzer-lsp',
      source: './plugins/rust-analyzer-lsp',
      strict: false,
      lspServers: {
        'rust-analyzer': { command: 'rust-analyzer', extensionToLanguage: { '.rs': 'rust' } },
      },
    })

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
    const entry = kitEntry({
      name: 'box',
      source: './box',
      skills: ['./skills/own', './skills/extra'],
    })
    await applyEntryManifestOverrides(dir, entry)
    const written = JSON.parse(
      await fs.readFile(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'),
    )
    expect(written.skills).toEqual(['./skills/own', './skills/extra'])
  })

  it('is a no-op when the entry declares no components', async () => {
    const entry = kitEntry({ name: 'x', source: './x' })
    await applyEntryManifestOverrides(dir, entry)
    expect(fs.access(join(dir, 'plugin.json'))).rejects.toThrow()
  })
})
