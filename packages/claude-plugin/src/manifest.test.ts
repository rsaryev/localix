import { describe, expect, test } from 'bun:test'
import { checkPluginName, componentSources, parseClaudePluginManifest, parseHooksFile } from '.'

describe('parseClaudePluginManifest', () => {
  test('loads the documented fields and keeps the rest of a plugin when one field is wrong', () => {
    const { manifest, issues } = parseClaudePluginManifest({
      name: 'deploy-tools',
      version: '1.2.0',
      author: { name: 'Dev' },
      skills: './custom-skills',
      keywords: 'not-a-list',
      outputStyle: 'typo',
    })
    expect(manifest).toMatchObject({
      name: 'deploy-tools',
      version: '1.2.0',
      skills: './custom-skills',
    })
    expect(manifest).not.toHaveProperty('keywords')
    expect(issues.map((found) => [found.severity, found.path])).toEqual([
      ['error', 'keywords'],
      ['warning', 'outputStyle'],
    ])
  })

  test('a manifest is optional: the folder name stands in for a missing name', () => {
    expect(parseClaudePluginManifest({}, { fallbackName: 'my-tools' }).manifest?.name).toBe(
      'my-tools',
    )
    const missing = parseClaudePluginManifest({})
    expect(missing.manifest).toBeNull()
    expect(missing.issues[0]?.message).toContain('no "name"')
  })

  test('a userConfig option that breaks its strict shape is dropped, not the plugin', () => {
    const { manifest, issues } = parseClaudePluginManifest({
      name: 'svc',
      userConfig: {
        TOKEN: { type: 'string', title: 'Token', description: 'API token', sensitive: true },
        BAD: { type: 'string', title: 'Bad', description: 'x', secret: true },
      },
    })
    expect(Object.keys(manifest?.userConfig ?? {})).toEqual(['TOKEN'])
    expect(issues).toEqual([expect.objectContaining({ severity: 'error', path: 'userConfig.BAD' })])
  })

  test('component paths start with ./ and stay inside the plugin', () => {
    const { issues } = parseClaudePluginManifest({
      name: 'paths',
      skills: '.',
      agents: ['agents/a.md', './../outside.md'],
      mcpServers: 'https://example.com/server.mcpb',
    })
    expect(issues.map((found) => found.message)).toEqual([
      'agents path must start with "./": agents/a.md',
      'agents path escapes plugin directory: ./../outside.md',
    ])
  })

  test('the commands object map takes exactly one of source or content', () => {
    const { issues } = parseClaudePluginManifest({
      name: 'cmds',
      commands: { both: { source: './a.md', content: 'x' } },
    })
    expect(issues[0]).toMatchObject({ severity: 'error', path: 'commands' })
  })

  test('top-level monitors and themes still load, with a warning', () => {
    const { manifest, issues } = parseClaudePluginManifest({ name: 'mon', monitors: [] })
    expect(manifest?.monitors).toEqual([])
    expect(issues).toEqual([expect.objectContaining({ severity: 'warning', path: 'monitors' })])
  })
})

describe('checkPluginName', () => {
  test.each([
    ['claude-helper', 'error'],
    ['Claude_Code', 'error'],
    ['official-anthropic-tools', 'error'],
    ['my-claude-tools', 'warning'],
    ['myTools', 'warning'],
    ['has space', 'error'],
    ['scope:name', 'error'],
  ])('%s → %s', (name, severity) => {
    expect(checkPluginName(name).map((found) => found.severity)).toContain(severity as 'error')
  })

  test('a reserved name still loads, as Anthropic’s own plugins do in Claude Code', () => {
    const { manifest, issues } = parseClaudePluginManifest({ name: 'claude-code-setup' })
    expect(manifest?.name).toBe('claude-code-setup')
    expect(issues).toEqual([])
  })

  test('a kebab-case name of your own passes', () => {
    expect(checkPluginName('deploy-tools')).toEqual([])
  })
})

describe('componentSources', () => {
  test('skills add to the default folder; commands and agents replace theirs', () => {
    const sources = componentSources({
      skills: './extra',
      commands: ['./cmd/deploy.md'],
      agents: './agents/reviewer.md',
    })
    expect(sources.skills).toEqual({ paths: ['./extra'], includeDefault: true })
    expect(sources.commands).toMatchObject({ paths: ['./cmd/deploy.md'], includeDefault: false })
    expect(sources.agents).toEqual({ paths: ['./agents/reviewer.md'], includeDefault: false })
    expect(componentSources({}).commands.includeDefault).toBe(true)
  })

  test('hooks, MCP and LSP sources merge files and inline maps', () => {
    const sources = componentSources({
      mcpServers: ['./more.mcp.json', { db: { command: 'db-server' } }],
      hooks: { PreToolUse: [] },
    })
    expect(sources.mcpServers).toEqual({
      files: ['./more.mcp.json'],
      inline: [{ db: { command: 'db-server' } }],
    })
    expect(sources.hooks).toEqual({ files: [], inline: [{ PreToolUse: [] }] })
  })

  test('the commands object map replaces the folder and keeps its entries', () => {
    const sources = componentSources({ commands: { hello: { content: 'Say hello' } } })
    expect(sources.commands).toEqual({
      paths: [],
      includeDefault: false,
      entries: { hello: { content: 'Say hello' } },
    })
  })

  test('experimental monitors win over the top-level field', () => {
    expect(
      componentSources({ monitors: './a.json', experimental: { monitors: [] } }).monitors,
    ).toEqual({ inline: [] })
  })
})

describe('parseHooksFile', () => {
  test('a hooks file wraps its events and may name one hooks module', () => {
    const { file, issues } = parseHooksFile(
      { hooks: { Stop: [] }, modules: ['./register.ts'] },
      'hooks/hooks.json',
    )
    expect(file).toEqual({ hooks: { Stop: [] }, modules: ['./register.ts'] })
    expect(issues).toEqual([])
  })

  test('a bare event map is refused, as Claude Code refuses it', () => {
    expect(parseHooksFile({ Stop: [] }, 'hooks/hooks.json').file).toBeNull()
  })

  test('more than one module, or one that is not code, is an error', () => {
    const { issues } = parseHooksFile({ modules: ['./a.js', './b.py'] }, 'hooks/hooks.json')
    expect(issues.map((found) => found.message)).toEqual([
      'A plugin has at most one hooks module',
      'Not a JavaScript or TypeScript module: ./b.py',
    ])
  })
})
