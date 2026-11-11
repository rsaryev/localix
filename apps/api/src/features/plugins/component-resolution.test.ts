import { describe, expect, it } from 'bun:test'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import { loadManifest } from './manifest-load'
import { kitEntry } from './kit/testing'

/**
 * A plugin fetched from a marketplace is copied as it was fetched and read with its entry: the kit
 * merges the two at load (`mergeEntryWithManifest`), so nothing is written into the copy.
 */
const dir = tempDirPerTest('entry-load-')
const load = (fields: Record<string, unknown>) =>
  loadManifest(dir(), 'global', '', { entry: kitEntry(fields), name: String(fields.name) })

describe('a fetched plugin read with its entry', () => {
  it('a box-style entry with no plugin.json exposes the skills it lists', async () => {
    writeTree(dir(), {
      'skills/box/SKILL.md': '---\nname: box\ndescription: Work with Box\n---\nBody\n',
    })
    const plugin = await load({
      name: 'box',
      source: { source: 'url', url: 'https://x/y.git', sha: 'c'.repeat(40) },
      skills: ['./skills/box'],
    })
    expect(plugin.error).toBeUndefined()
    expect(plugin.provides.skills).toContain('box')
  })

  it("a strict:false entry's LSP servers are the plugin's", async () => {
    writeTree(dir(), { LICENSE: 'MIT' })
    const plugin = await load({
      name: 'rust-analyzer-lsp',
      source: './plugins/rust-analyzer-lsp',
      strict: false,
      lspServers: {
        'rust-analyzer': { command: 'rust-analyzer', extensionToLanguage: { '.rs': 'rust' } },
      },
    })
    expect(plugin.error).toBeUndefined()
    expect(plugin.provides.lspServers).toEqual(['rust-analyzer'])
  })

  it("plugin.json's version and the entry's description win, and nothing is written", async () => {
    const manifest = JSON.stringify({ name: 'p', version: '1.0.0', description: 'own desc' })
    writeTree(dir(), { '.claude-plugin/plugin.json': manifest })
    const plugin = await load({
      name: 'p',
      source: './p',
      version: '3.1.4',
      description: 'entry desc',
    })
    expect(plugin.manifest).toMatchObject({ version: '1.0.0', description: 'entry desc' })
    expect(await Bun.file(`${dir()}/.claude-plugin/plugin.json`).text()).toBe(manifest)
  })

  it("the entry's skills add to plugin.json's", async () => {
    writeTree(dir(), {
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'box', skills: ['./skills/own'] }),
      'skills/own/SKILL.md': '---\nname: own\ndescription: d\n---\nb\n',
      'skills/extra/SKILL.md': '---\nname: extra\ndescription: d\n---\nb\n',
    })
    const plugin = await load({ name: 'box', source: './box', skills: ['./skills/extra'] })
    expect([...plugin.provides.skills].sort()).toEqual(['extra', 'own'])
  })

  it('a strict:false entry with components and a plugin.json does not load', async () => {
    writeTree(dir(), { '.claude-plugin/plugin.json': JSON.stringify({ name: 'x' }) })
    const plugin = await load({ name: 'x', source: './x', strict: false, skills: ['./skills/x'] })
    expect(plugin.error).toContain('conflicting manifests')
  })

  it('an entry whose source is the marketplace root loads only the skills it lists', async () => {
    writeTree(dir(), {
      'skills/xlsx/SKILL.md': '---\nname: xlsx\ndescription: Sheets\n---\nBody\n',
      'skills/pdf/SKILL.md': '---\nname: pdf\ndescription: PDFs\n---\nBody\n',
    })
    const plugin = await load({
      name: 'document-skills',
      source: './',
      strict: false,
      skills: ['./skills/xlsx'],
    })
    expect(plugin.error).toBeUndefined()
    expect(plugin.provides.skills).toEqual(['xlsx'])
  })
})
