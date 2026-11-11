import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { readPluginFolder } from './read-folder'
import { kitEntry } from '../testing'

const dir = tempDirPerTest('kit-catalog')
const manifest = (json: Record<string, unknown>) => ({
  '.claude-plugin/plugin.json': JSON.stringify(json),
})

async function read(tree: Record<string, string>, from = {}) {
  writeTree(dir(), tree)
  return readPluginFolder(dir(), from)
}

describe('a plugin folder read by the kit', () => {
  test('maps the manifest a person sees: author as text, userConfig and channel options as config', async () => {
    const found = await read({
      ...manifest({
        name: 'fmt',
        version: '1.2.0',
        description: 'Formats',
        author: { name: 'Ada' },
        userConfig: {
          TOKEN: { type: 'string', title: 'Token', description: 'API token', sensitive: true },
          TAGS: {
            type: 'string',
            title: 'Tags',
            description: 'Tags',
            multiple: true,
            default: ['a'],
          },
        },
        channels: [
          {
            server: 'chat',
            userConfig: { ROOM: { type: 'string', title: 'Room', description: 'Room' } },
          },
        ],
        mcpServers: { chat: { command: 'chat-server' } },
      }),
    })
    expect(found.manifest).toMatchObject({
      name: 'fmt',
      version: '1.2.0',
      description: 'Formats',
      author: 'Ada',
      origin: { format: 'claude-code' },
    })
    expect(found.manifest.config?.TOKEN).toMatchObject({ secret: true })
    expect(found.manifest.config?.TAGS?.default).toBe('["a"]')
    expect(Object.keys(found.manifest.config ?? {}).sort()).toEqual(['ROOM', 'TAGS', 'TOKEN'])
    expect(found.rawManifest?.version).toBe('1.2.0')
    expect(found.error).toBeUndefined()
  })

  test('a folder with no manifest is a plugin named after itself, at version 0.0.0', async () => {
    const found = await read({ 'skills/review/SKILL.md': '---\ndescription: Review\n---\nGo' })
    expect(found.manifest.name).toBe(dir().split('/').pop()!)
    expect(found.manifest.version).toBe('0.0.0')
    expect(found.provides.skills).toEqual(['review'])
  })

  test('a mini app folder is refused with the Store hint', async () => {
    const found = await read({ '.localix-mini-app/mini-app.json': '{"name":"app"}' })
    expect(found.error).toContain('This folder is a mini app')
    expect(found.commands).toEqual([])
  })

  test('a manifest that is not JSON is the error and nothing loads', async () => {
    const found = await read({ '.claude-plugin/plugin.json': '{nope' })
    expect(found.error).toContain('could not be read as JSON')
  })

  test('commands carry their frontmatter in Localix tool names, the when-to-use joined to the description', async () => {
    const found = await read({
      ...manifest({ name: 'db' }),
      'commands/db/migrate.md':
        '---\ndescription: Migrate\nwhen_to_use: after a schema change\nallowed-tools: Bash(git add:*) Read\nargument-hint: [target]\narguments: target\nmodel: haiku\n---\nMigrate $target',
    })
    expect(found.commands).toEqual([
      {
        name: 'db:migrate',
        description: 'Migrate after a schema change',
        args: [],
        prompt: 'Migrate $target',
        argumentHint: '[target]',
        arguments: ['target'],
        allowedTools: ['Bash(git add:*)', 'Read'],
        model: 'haiku',
      },
    ])
    expect(found.provides.commands).toEqual(['db:migrate'])
  })

  test('a commands object map entry with inline content is a command without a file', async () => {
    const found = await read({
      ...manifest({ name: 'kit', commands: { hello: { content: 'Say hi', description: 'Hi' } } }),
    })
    expect(found.commands.map((c) => [c.name, c.description, c.prompt.trim()])).toEqual([
      ['hello', 'Hi', 'Say hi'],
    ])
  })

  test('agents are named below the plugin, their tools as the file wrote them, worktree isolation kept', async () => {
    const found = await read({
      ...manifest({ name: 'review' }),
      'agents/team/security.md':
        '---\nname: security\ndescription: Checks\ntools: Read, Bash, Agent(worker)\nisolation: worktree\nskills: audit\nmaxTurns: 5\n---\nBe careful',
    })
    expect(found.agents).toHaveLength(1)
    expect(found.agents[0]).toMatchObject({
      name: 'security',
      scopedName: 'review:team:security',
      definition: {
        description: 'Checks',
        prompt: 'Be careful',
        tools: ['Read', 'Bash', 'Agent(worker)'],
        skills: ['audit'],
        maxTurns: 5,
      },
      extras: { isolation: 'worktree' },
    })
    expect(found.provides.agents).toEqual(['review:team:security'])
  })

  test('hooks, servers, monitors and the components reach their runtime shapes', async () => {
    const found = await read({
      ...manifest({ name: 'ops' }),
      'hooks/hooks.json': JSON.stringify({
        hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] },
      }),
      '.mcp.json': JSON.stringify({ mcpServers: { db: { command: 'db-mcp', args: ['-q'] } } }),
      '.lsp.json': JSON.stringify({
        go: { command: 'gopls', extensionToLanguage: { '.go': 'go' } },
      }),
      'monitors/monitors.json': JSON.stringify([
        { name: 'tail', command: 'tail -f log', description: 'Log' },
        { name: 'w', command: 'watch', description: 'W', when: 'on-skill-invoke:deploy' },
      ]),
      'output-styles/terse.md': '---\nname: Terse\ndescription: Short\n---\nBe short.',
      'themes/dusk.json': JSON.stringify({
        name: 'Dusk',
        base: 'dark',
        overrides: { claude: '#112233' },
      }),
      'settings.json': JSON.stringify({ agent: 'missing' }),
    })
    const entry = found.entrypoints
    expect(entry.hookConfigs).toEqual([
      { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } },
    ])
    expect(entry.mcpServers.db).toMatchObject({ command: 'db-mcp', args: ['-q'] })
    expect(found.provides.mcpServers).toEqual(['db'])
    expect(Object.keys(entry.lspServers)).toEqual(['go'])
    expect(found.provides.lspServers).toEqual(['go'])
    expect(entry.monitors).toEqual([
      { name: 'tail', command: 'tail -f log', description: 'Log', when: { kind: 'always' } },
      {
        name: 'w',
        command: 'watch',
        description: 'W',
        when: { kind: 'on-skill-invoke', skill: 'deploy' },
      },
    ])
    expect(entry.components?.outputStyles).toEqual([
      {
        name: 'Terse',
        description: 'Short',
        keepCodingInstructions: false,
        forceForPlugin: false,
        prompt: 'Be short.',
      },
    ])
    expect(entry.components?.themes).toEqual([
      { slug: 'dusk', name: 'Dusk', base: 'dark', overrides: { claude: '#112233' } },
    ])
    expect(entry.components?.settings).toEqual({ agent: 'missing' })
  })

  test('a hooks module named in hooks/hooks.json is the plugin mod, inside the plugin', async () => {
    const found = await read({
      ...manifest({ name: 'mod' }),
      'hooks/hooks.json': JSON.stringify({ modules: ['./index.ts'] }),
      'hooks/index.ts': 'export default () => {}',
    })
    expect(found.entrypoints.hookModule).toBe(join(dir(), 'hooks/index.ts'))
  })

  test('a marketplace entry is merged into the manifest the plugin loads with', async () => {
    const found = await read(
      { ...manifest({ name: 'fmt', description: 'Own' }) },
      {
        entry: kitEntry({
          name: 'fmt',
          source: './fmt',
          description: 'From the entry',
          version: '2.0.0',
        }),
      },
    )
    expect(found.manifest.version).toBe('2.0.0')
  })

  test('an entry stands in for a missing manifest and names the plugin', async () => {
    const found = await read(
      { 'skills/a/SKILL.md': '---\ndescription: A\n---\nA' },
      { entry: kitEntry({ name: 'gopls-lsp', source: './x', description: 'Go' }) },
    )
    expect(found.manifest.name).toBe('gopls-lsp')
    expect(found.manifest.description).toBe('Go')
  })

  test("an entry's inline hooks replace the hook file's for the same event", async () => {
    const hook = (command: string) => [{ hooks: [{ type: 'command', command }] }]
    const found = await read(
      {
        ...manifest({ name: 'fmt' }),
        'hooks/hooks.json': JSON.stringify({ hooks: { Stop: hook('from-file') } }),
      },
      { entry: kitEntry({ name: 'fmt', source: './fmt', hooks: { Stop: hook('from-entry') } }) },
    )
    expect(found.entrypoints.hookConfigs).toEqual([{ hooks: { Stop: hook('from-entry') } }])
  })

  test('with no manifest and no entry, the given name names the plugin', async () => {
    const found = await read(
      { 'skills/a/SKILL.md': '---\ndescription: A\n---\nA' },
      { name: 'lsp' },
    )
    expect(found.manifest.name).toBe('lsp')
  })
})
