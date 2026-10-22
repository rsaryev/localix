import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { MANIFEST_FILE as CLAUDE_CODE_PLUGIN_MANIFEST } from '@localixai/claude-plugin'

import { CLAUDE_CODE_MARKETPLACE, isClaudeCodeMarketplace } from './claude-code-marketplace'
import { loadManifest } from './discovery'
import { validatePlugin } from './validate'

/**
 * Claude Code plugins load IN PLACE, against fixtures shaped like the plugins in the official
 * Claude Code marketplace (plugins-reference: manifest schema, path behavior rules, hooks, MCP,
 * LSP, user config, plugin variables). Nothing is written beside them.
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

async function writeAndLoad(manifest: Record<string, unknown>) {
  await write(CLAUDE_CODE_PLUGIN_MANIFEST, manifest)
  const plugin = await loadManifest(dir, 'global', '')
  const notes = (plugin.layoutIssues ?? []).map((found) => `${found.path}: ${found.message}`)
  return { notes, plugin }
}

describe('Claude Code marketplace detection', () => {
  it('recognizes a Claude Code-only marketplace', async () => {
    await write(CLAUDE_CODE_MARKETPLACE, { name: 'm', owner: { name: 'o' }, plugins: [] })
    expect(await isClaudeCodeMarketplace(dir)).toBe(true)
    await write('.localix-plugin/marketplace.json', { name: 'm', plugins: [] })
    expect(await isClaudeCodeMarketplace(dir)).toBe(false)
  })
})

describe('a Claude Code plugin in place', () => {
  it('reads the metadata and records the format', async () => {
    const { plugin } = await writeAndLoad({
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
      origin: { format: 'claude-code' },
    })
    expect(plugin.layout).toBe('plugin')
    // Nothing is written beside the plugin.
    await expect(fs.access(join(dir, 'plugin.json'))).rejects.toThrow()
  })

  it('materializes REPLACE semantics for listed commands and agents', async () => {
    await write('commands/default.md', md('description: default', 'Default.'))
    await write('custom/commands/special.md', md('description: special', 'Special $ARGUMENTS'))
    await write('agents/default-agent.md', md('name: default-agent\ndescription: d', 'D.'))
    await write('custom/agents/reviewer.md', md('name: reviewer\ndescription: r', 'Review.'))
    const { plugin } = await writeAndLoad({
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
    const { plugin } = await writeAndLoad({ name: 'defaults' })
    expect(plugin.manifest.defaultDirs).toBeUndefined()
    expect(plugin.provides.commands.sort()).toEqual(['deploy', 'infra:scale'])
    expect(plugin.provides.agents).toEqual(['defaults:planner'])
  })

  it('skills add to the default skills dir', async () => {
    await write('skills/one/SKILL.md', md('name: one\ndescription: One', 'One.'))
    await write('custom/skills/two/SKILL.md', md('name: two\ndescription: Two', 'Two.'))
    const { plugin } = await writeAndLoad({ name: 'skills', skills: './custom/skills/' })
    expect(plugin.provides.skills.sort()).toEqual(['one', 'two'])
  })

  it('runs its hooks and reports events Localix does not dispatch', async () => {
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
    const { notes, plugin } = await writeAndLoad({ name: 'hooked' })
    expect(plugin.entrypoints.hookConfigs).toHaveLength(1)
    // Plugin variables are native substitution variables: carried over verbatim.
    expect(JSON.stringify(plugin.entrypoints.hookConfigs)).toContain('${CLAUDE_PLUGIN_ROOT}')
    expect(notes).toEqual(['hooks: Hook events not dispatched by Localix: PermissionRequest'])
  })

  it('resolves .mcp.json and lspServers', async () => {
    await write('.mcp.json', {
      mcpServers: {
        db: { command: '${CLAUDE_PLUGIN_ROOT}/bin/db', args: ['--data', '${CLAUDE_PLUGIN_DATA}'] },
      },
    })
    const { plugin } = await writeAndLoad({
      name: 'servers',
      lspServers: {
        go: { command: 'gopls', args: ['serve'], extensionToLanguage: { '.go': 'go' } },
      },
    })
    expect(plugin.provides.mcpServers).toEqual(['db'])
    expect(plugin.provides.lspServers).toEqual(['go'])
  })

  it('reads userConfig (sensitive → secret) and experimental.monitors', async () => {
    const { notes, plugin } = await writeAndLoad({
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
    expect(plugin.entrypoints.monitors.map((m) => m.name)).toEqual(['tail'])
    expect(notes.join('\n')).toContain('Output styles are not used')
    expect(notes.join('\n')).toContain('channels are not used')
    expect(notes.join('\n')).toContain('Themes are not used')
  })

  it('loads an LSP-only plugin (manifest without component dirs)', async () => {
    const { plugin } = await writeAndLoad({
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
    // Authoring nudges are not shown for a Claude Code plugin.
    const { warnings } = validatePlugin(plugin)
    expect(warnings.join('\n')).not.toContain('no license')
    expect(warnings.join('\n')).not.toContain('apiVersion')
  })

  it('a broken manifest says which file and why, and the folder name stands in', async () => {
    await write(CLAUDE_CODE_PLUGIN_MANIFEST, '{ nope')
    let plugin = await loadManifest(dir, 'global', '')
    expect(plugin.error).toContain('.claude-plugin/plugin.json')
    await write(CLAUDE_CODE_PLUGIN_MANIFEST, '[1]')
    plugin = await loadManifest(dir, 'global', '')
    expect(plugin.error).toContain('not a JSON object')
    await write(CLAUDE_CODE_PLUGIN_MANIFEST, { name: 'Bad Name!' })
    plugin = await loadManifest(dir, 'global', '')
    expect(plugin.error).toContain('may not contain spaces')
  })

  it('loads Anthropic’s own plugins as they are written', async () => {
    // A reserved name (their own) and an unquoted `argument-hint: [name]`, a YAML list.
    await write(
      'commands/new-app.md',
      md('description: New app\nargument-hint: [project-name]', 'Make $ARGUMENTS'),
    )
    const { notes, plugin } = await writeAndLoad({ name: 'claude-code-setup' })
    expect(plugin.error).toBeUndefined()
    expect(plugin.commands[0]).toMatchObject({ name: 'new-app', argumentHint: '[project-name]' })
    expect(notes).toEqual([])
    const warnings = validatePlugin(plugin).warnings.join('\n')
    expect(warnings).not.toContain('reserved')
    expect(warnings).not.toContain('argumentHint')
  })

  it('a hooks module is reported until mods run here', async () => {
    await write('hooks/hooks.json', { hooks: {}, modules: ['./register.ts'] })
    const { notes } = await writeAndLoad({ name: 'a-mod' })
    expect(notes).toEqual([
      'hooks#modules: The hooks module (mod) does not run in Localix yet; its hooks.json hooks do',
    ])
  })
})
