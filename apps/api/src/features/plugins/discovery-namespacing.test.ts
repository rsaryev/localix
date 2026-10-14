import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { collectMarkdownFiles, parseCommandFile, parseAgentFile } from './discovery-cc-files'
import { discoverPlugins, loadManifest } from './discovery'
import { validateCompatibility } from './validate-compat'

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

describe('parseCommandFile / parseAgentFile with a namespaced override', () => {
  it('parses a command file under a namespaced name', async () => {
    const plug = join(dir, 'nested-plugin')
    const cmd = await parseCommandFile(join(plug, 'commands', 'infra', 'scale.md'), 'infra:scale')
    expect(cmd?.name).toBe('infra:scale')
    expect(cmd?.description).toBe('Scale infra')
  })

  it('a frontmatter agent name overrides the leaf but keeps the subdir prefix', async () => {
    const plug = join(dir, 'nested-plugin')
    const noName = await parseAgentFile(
      join(plug, 'agents', 'sample', 'security.md'),
      'sample:security',
    )
    expect(noName?.name).toBe('sample:security')
    const withName = await parseAgentFile(join(plug, 'agents', 'sample', 'lead.md'), 'sample:lead')
    expect(withName?.name).toBe('sample:sec-lead')
  })
})

describe('CC REPLACE vs localix ADD semantics for manifest commands/agents', () => {
  let plug: string
  let ccPlug: string

  beforeAll(async () => {
    plug = join(dir, 'replace-plugin')
    await fs.mkdir(join(plug, 'commands'), { recursive: true })
    await fs.mkdir(join(plug, 'agents'), { recursive: true })
    await fs.mkdir(join(plug, 'extra-cmds'), { recursive: true })
    await fs.mkdir(join(plug, 'extra-agents'), { recursive: true })
    await fs.mkdir(join(plug, 'skills', 'default-skill'), { recursive: true })
    await fs.mkdir(join(plug, 'more-skills', 'extra-skill'), { recursive: true })
    const cmd = '---\ndescription: d\n---\nBody.'
    const agent = '---\ndescription: d\n---\nYou review.'
    await fs.writeFile(join(plug, 'commands', 'default-cmd.md'), cmd)
    await fs.writeFile(join(plug, 'extra-cmds', 'alt-cmd.md'), cmd)
    await fs.writeFile(join(plug, 'agents', 'default-agent.md'), agent)
    await fs.writeFile(join(plug, 'extra-agents', 'alt-agent.md'), agent)
    await fs.writeFile(join(plug, 'skills', 'default-skill', 'SKILL.md'), '# s')
    await fs.writeFile(join(plug, 'more-skills', 'extra-skill', 'SKILL.md'), '# s')
    await fs.writeFile(
      join(plug, 'plugin.json'),
      JSON.stringify({
        name: 'replace-plugin',
        commands: ['./extra-cmds'],
        agents: ['./extra-agents'],
        skills: ['./more-skills'],
      }),
    )
    ccPlug = join(dir, 'replace-plugin-cc')
    await fs.cp(plug, ccPlug, { recursive: true })
    await fs.mkdir(join(ccPlug, '.claude-plugin'), { recursive: true })
    await fs.rename(join(ccPlug, 'plugin.json'), join(ccPlug, '.claude-plugin', 'plugin.json'))
  })

  it('localix-origin plugin stays ADDITIVE (default dirs scanned alongside listed paths)', async () => {
    const plugin = await loadManifest(plug, 'global', '')
    expect(plugin.provides.commands).toEqual(expect.arrayContaining(['alt-cmd', 'default-cmd']))
    expect(plugin.provides.agents).toEqual(
      expect.arrayContaining(['replace-plugin:alt-agent', 'replace-plugin:default-agent']),
    )
    expect(plugin.entrypoints.ccReplacedDefaults).toBeUndefined()
    expect(plugin.ccOrigin).toBeUndefined()
  })

  it('CC-origin plugin gets REPLACE: listed commands/agents hide the default dirs', async () => {
    const plugin = await loadManifest(ccPlug, 'global', '')
    expect(plugin.provides.commands).toEqual(['alt-cmd'])
    expect(plugin.provides.agents).toEqual(['replace-plugin:alt-agent'])
    expect(plugin.ccOrigin).toBe(true)
    // Both hidden default dirs are recorded and surfaced as validate advisories.
    expect(plugin.entrypoints.ccReplacedDefaults?.sort()).toEqual(['agents', 'commands'])
    const { warnings } = validateCompatibility(plugin)
    expect(warnings.join('\n')).toContain('REPLACE semantics')
  })

  it('preserves CC origin across normal .localix discovery and rediscovery', async () => {
    const home = join(dir, 'restart-home')
    const installed = join(home, '.localix', 'plugins', 'replace-plugin')
    await fs.mkdir(join(home, '.localix', 'plugins'), { recursive: true })
    await fs.cp(ccPlug, installed, { recursive: true })

    for (let pass = 0; pass < 2; pass++) {
      const found = await discoverPlugins({ homeDir: home, cwd: null, includeBundled: false })
      const plugin = found.find((candidate) => candidate.manifest.name === 'replace-plugin')
      expect(plugin?.ccOrigin).toBe(true)
      expect(plugin?.provides.commands).toEqual(['alt-cmd'])
      expect(plugin?.provides.agents).toEqual(['replace-plugin:alt-agent'])
    }
  })

  it('skills always ADD for both origins', async () => {
    const localix = await loadManifest(plug, 'global', '')
    const cc = await loadManifest(ccPlug, 'global', '')
    for (const p of [localix, cc]) {
      expect(p.provides.skills.sort()).toEqual(['default-skill', 'extra-skill'])
    }
  })

  it('manifest-less plugins scan the default dirs (origin semantics are identical)', async () => {
    const bare = join(dir, 'bare-cc-plugin')
    await fs.mkdir(join(bare, 'commands'), { recursive: true })
    await fs.writeFile(join(bare, 'commands', 'only.md'), '---\ndescription: d\n---\nBody.')
    const plugin = await loadManifest(bare, 'global', '')
    expect(plugin.provides.commands).toEqual(['only'])
    expect(plugin.entrypoints.ccReplacedDefaults).toBeUndefined()
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
