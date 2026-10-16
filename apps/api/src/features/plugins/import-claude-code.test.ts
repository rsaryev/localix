import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { loadManifest } from './discovery'
import {
  CLAUDE_CODE_MARKETPLACE,
  CLAUDE_CODE_PLUGIN_MANIFEST,
  ClaudeCodeImportError,
  convertClaudeCodeManifest,
  importClaudeCodePlugin,
  isClaudeCodeMarketplace,
  isClaudeCodePlugin,
  readClaudeCodePluginName,
} from './import-claude-code'
import { validatePlugin } from './validate'

/**
 * Claude Code compatibility of the install-time importer, against fixtures shaped like the
 * plugins in the official Claude Code marketplace (plugins-reference: manifest schema, path
 * behavior rules, hooks, MCP, LSP, user config, plugin variables).
 */

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'cc-import-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function write(rel: string, content: unknown): Promise<void> {
  const file = join(dir, rel)
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, typeof content === 'string' ? content : JSON.stringify(content))
}

const md = (front: string, body: string) => `---\n${front}\n---\n\n${body}\n`

async function importAndLoad(manifest: Record<string, unknown>) {
  await write(CLAUDE_CODE_PLUGIN_MANIFEST, manifest)
  const result = await importClaudeCodePlugin(dir, { source: 'owner/repo', now: () => 'T' })
  return { result, plugin: await loadManifest(dir, 'global', '') }
}

describe('Claude Code plugin detection', () => {
  it('recognizes the Claude Code layout only when no native manifest exists', async () => {
    expect(await isClaudeCodePlugin(dir)).toBe(false)
    await write(CLAUDE_CODE_PLUGIN_MANIFEST, { name: 'cc' })
    expect(await isClaudeCodePlugin(dir)).toBe(true)
    expect(await readClaudeCodePluginName(dir)).toBe('cc')
    await write('plugin.json', { name: 'native' })
    expect(await isClaudeCodePlugin(dir)).toBe(false)
    expect(await importClaudeCodePlugin(dir)).toBeNull()
  })

  it('recognizes a Claude Code-only marketplace', async () => {
    await write(CLAUDE_CODE_MARKETPLACE, { name: 'm', owner: { name: 'o' }, plugins: [] })
    expect(await isClaudeCodeMarketplace(dir)).toBe(true)
    await write('.localix-plugin/marketplace.json', { name: 'm', plugins: [] })
    expect(await isClaudeCodeMarketplace(dir)).toBe(false)
  })
})

describe('importClaudeCodePlugin', () => {
  it('converts metadata and records the origin', async () => {
    const { plugin } = await importAndLoad({
      name: 'full-plugin',
      displayName: 'Full Plugin',
      version: '1.2.0',
      description: 'Everything',
      author: { name: 'Author', email: 'a@example.com' },
      homepage: 'https://docs.example.com',
      repository: 'https://github.com/a/b',
      license: 'MIT',
      keywords: ['k'],
      $schema: 'https://example.com/schema.json',
    })
    expect(plugin.error).toBeUndefined()
    expect(plugin.manifest).toMatchObject({
      name: 'full-plugin',
      displayName: 'Full Plugin',
      version: '1.2.0',
      author: 'Author',
      license: 'MIT',
      migratedFrom: 'owner/repo',
      origin: { format: 'claude-code', source: 'owner/repo', version: '1.2.0', importedAt: 'T' },
    })
    // The original stays in place; runtime reads only the native manifest.
    await fs.access(join(dir, CLAUDE_CODE_PLUGIN_MANIFEST))
    const native = JSON.parse(await fs.readFile(join(dir, 'plugin.json'), 'utf8'))
    expect(native.$schema).toBeUndefined()
  })

  it('materializes REPLACE semantics for listed commands and agents', async () => {
    await write('commands/default.md', md('description: default', 'Default.'))
    await write('custom/commands/special.md', md('description: special', 'Special $ARGUMENTS'))
    await write('agents/default-agent.md', md('name: default-agent\ndescription: d', 'D.'))
    await write('custom/agents/reviewer.md', md('name: reviewer\ndescription: r', 'Review.'))
    const { plugin } = await importAndLoad({
      name: 'replace',
      commands: './custom/commands/special.md',
      agents: ['./custom/agents/reviewer.md'],
    })
    expect(plugin.manifest.defaultDirs).toEqual({ commands: false, agents: false })
    expect(plugin.provides.commands).toEqual(['special'])
    expect(plugin.provides.agents).toEqual(['replace:reviewer'])
  })

  it('keeps default command/agent dirs (with nested namespacing) when nothing is listed', async () => {
    await write('commands/deploy.md', md('description: Deploy', 'Deploy $1'))
    await write('commands/infra/scale.md', md('description: Scale', 'Scale.'))
    await write('agents/planner.md', md('name: planner\ndescription: Plans', 'Plan.'))
    const { plugin } = await importAndLoad({ name: 'defaults' })
    expect(plugin.manifest.defaultDirs).toBeUndefined()
    expect(plugin.provides.commands.sort()).toEqual(['deploy', 'infra:scale'])
    expect(plugin.provides.agents).toEqual(['defaults:planner'])
  })

  it('skills add to the default skills dir', async () => {
    await write('skills/one/SKILL.md', md('name: one\ndescription: One', 'One.'))
    await write('custom/skills/two/SKILL.md', md('name: two\ndescription: Two', 'Two.'))
    const { plugin } = await importAndLoad({ name: 'skills', skills: './custom/skills/' })
    expect(plugin.provides.skills.sort()).toEqual(['one', 'two'])
  })

  it('carries hooks over and reports events Localix does not dispatch', async () => {
    const command = 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/check.sh"'
    const handler = [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command }] }]
    await write('hooks/hooks.json', {
      hooks: {
        SessionStart: handler,
        UserPromptSubmit: handler,
        PreToolUse: handler,
        PostToolUse: handler,
        Stop: handler,
        SubagentStart: handler,
        SubagentStop: handler,
        PreCompact: handler,
        Notification: handler,
        SessionEnd: handler,
        PermissionRequest: handler,
      },
    })
    const { result, plugin } = await importAndLoad({ name: 'hooked' })
    expect(plugin.entrypoints.hookConfigs).toHaveLength(1)
    // Plugin variables are native substitution variables: carried over verbatim.
    expect(JSON.stringify(plugin.entrypoints.hookConfigs)).toContain('${CLAUDE_PLUGIN_ROOT}')
    expect(result?.notes).toEqual(['Hook events not dispatched by Localix: PermissionRequest'])
  })

  it('resolves .mcp.json and lspServers', async () => {
    await write('.mcp.json', {
      mcpServers: {
        db: { command: '${CLAUDE_PLUGIN_ROOT}/bin/db', args: ['--data', '${CLAUDE_PLUGIN_DATA}'] },
      },
    })
    const { plugin } = await importAndLoad({
      name: 'servers',
      lspServers: {
        go: { command: 'gopls', args: ['serve'], extensionToLanguage: { '.go': 'go' } },
      },
    })
    expect(plugin.provides.mcpServers).toEqual(['db'])
    expect(plugin.provides.lspServers).toEqual(['go'])
  })

  it('converts userConfig (sensitive → secret) and experimental.monitors', async () => {
    const { result, plugin } = await importAndLoad({
      name: 'configured',
      userConfig: {
        api_token: { type: 'string', title: 'Token', description: 'API token', sensitive: true },
      },
      experimental: {
        monitors: [{ name: 'tail', command: 'tail -f log', description: 'Log lines' }],
        themes: './themes/',
      },
      outputStyles: './styles/',
      channels: [{ server: 'telegram' }],
    })
    expect(plugin.error).toBeUndefined()
    expect(plugin.manifest.config?.api_token?.secret).toBe(true)
    expect(plugin.manifest.monitors?.map((m) => m.name)).toEqual(['tail'])
    expect(result?.notes.join('\n')).toContain('outputStyles')
    expect(result?.notes.join('\n')).toContain('channels')
    expect(result?.notes.join('\n')).toContain('experimental.themes')
  })

  it('imports an LSP-only plugin (manifest without component dirs)', async () => {
    const { plugin } = await importAndLoad({
      name: 'typescript-lsp',
      version: '1.0.0',
      lspServers: {
        typescript: {
          command: 'typescript-language-server',
          args: ['--stdio'],
          extensionToLanguage: { '.ts': 'typescript' },
        },
      },
    })
    expect(plugin.error).toBeUndefined()
    expect(plugin.provides.lspServers).toEqual(['typescript'])
    // Authoring nudges are not shown for an imported plugin.
    const { warnings } = validatePlugin(plugin)
    expect(warnings.join('\n')).not.toContain('no license')
    expect(warnings.join('\n')).not.toContain('apiVersion')
  })

  it('is idempotent: a second run is a no-op', async () => {
    await write(CLAUDE_CODE_PLUGIN_MANIFEST, { name: 'twice' })
    expect(await importClaudeCodePlugin(dir)).not.toBeNull()
    expect(await importClaudeCodePlugin(dir)).toBeNull()
  })

  it('rejects malformed JSON, non-object manifests and invalid names', async () => {
    await write(CLAUDE_CODE_PLUGIN_MANIFEST, '{ nope')
    expect(importClaudeCodePlugin(dir)).rejects.toBeInstanceOf(ClaudeCodeImportError)
    await write(CLAUDE_CODE_PLUGIN_MANIFEST, '[1]')
    expect(importClaudeCodePlugin(dir)).rejects.toBeInstanceOf(ClaudeCodeImportError)
    await write(CLAUDE_CODE_PLUGIN_MANIFEST, { name: 'Bad Name!' })
    expect(importClaudeCodePlugin(dir)).rejects.toBeInstanceOf(ClaudeCodeImportError)
    await expect(fs.access(join(dir, 'plugin.json'))).rejects.toThrow()
  })
})

describe('convertClaudeCodeManifest', () => {
  it('only flags REPLACE when string paths are listed (inline objects keep defaults)', () => {
    const { manifest } = convertClaudeCodeManifest(
      { name: 'x', commands: [{ name: 'hi', description: 'd', prompt: 'p' }] },
      {},
    )
    expect(manifest.defaultDirs).toBeUndefined()
    expect(manifest.origin).toEqual({ format: 'claude-code' })
  })
})
