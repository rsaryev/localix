import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { collectMarkdownFiles } from './discovery-cc-markdown-scan'
import { loadManifest } from './discovery'

/**
 * Nested-subdirectory namespacing for Claude Code `commands/`/`agents/` flat files:
 * `commands/foo/bar.md` → command `foo:bar`, `agents/sample/security.md` →
 * agent `sample:security` (full id `<plugin>:sample:security`).
 */

let dir: string

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'localix-cc-ns-'))
  const plug = join(dir, 'nested-plugin')
  // A manifest-less plugin (name = dir) with nested command + agent dirs.
  await fs.mkdir(join(plug, 'commands', 'infra'), { recursive: true })
  await fs.mkdir(join(plug, 'agents', 'sample'), { recursive: true })
  // Top-level command (no namespace).
  await fs.writeFile(
    join(plug, 'commands', 'deploy.md'),
    '---\ndescription: Deploy it\n---\nDeploy $ARGUMENTS.',
  )
  // Nested command → `infra:scale`.
  await fs.writeFile(
    join(plug, 'commands', 'infra', 'scale.md'),
    '---\ndescription: Scale infra\n---\nScale to $1 nodes.',
  )
  // Nested agent with NO frontmatter name → path-derived `sample:security`.
  await fs.writeFile(
    join(plug, 'agents', 'sample', 'security.md'),
    '---\ndescription: Security review\n---\nYou audit for vulnerabilities.',
  )
  // Nested agent WITH a frontmatter name → keeps the subdir prefix: `sample:sec-lead`.
  await fs.writeFile(
    join(plug, 'agents', 'sample', 'lead.md'),
    '---\nname: sec-lead\ndescription: Lead reviewer\n---\nYou lead the review.',
  )
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('collectMarkdownFiles (recursive namespacing)', () => {
  it('namespaces nested files and keeps top-level bare, name-sorted', async () => {
    const plug = join(dir, 'nested-plugin')
    const files = await collectMarkdownFiles(plug, undefined, 'commands')
    const names = files.map((f) => f.name)
    expect(names).toContain('deploy')
    expect(names).toContain('infra:scale')
    // Deterministic name-sorted order.
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })
})

describe('loadManifest wires namespaced commands + agents into provides', () => {
  it('exposes nested command + agent names', async () => {
    const plugin = await loadManifest(join(dir, 'nested-plugin'), 'global', '')
    expect(plugin.provides.commands).toContain('infra:scale')
    expect(plugin.provides.commands).toContain('deploy')
    // Agent fullNames are `<plugin>:<name>` — the plugin dir name is `nested-plugin`.
    expect(plugin.provides.agents).toContain('nested-plugin:sample:security')
    expect(plugin.provides.agents).toContain('nested-plugin:sample:sec-lead')
  })
})
