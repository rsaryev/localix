import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { loadManifest } from './discovery'
import { validateCompatibility } from './validate-compat'
import { validatePlugin } from './validate'

let dir: string

/**
 * Write a plugin as Claude Code reads one — `.claude-plugin/plugin.json` plus any component
 * files — and load it.
 */
async function writePlugin(
  name: string,
  dirName: string,
  manifest: Record<string, unknown>,
  files: Record<string, string> = {},
) {
  const pluginDir = join(dir, dirName)
  await fs.mkdir(join(pluginDir, '.claude-plugin'), { recursive: true })
  await fs.writeFile(
    join(pluginDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name, ...manifest }),
  )
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(dirname(join(pluginDir, rel)), { recursive: true })
    await fs.writeFile(join(pluginDir, rel), content)
  }
  return loadManifest(pluginDir, 'global', '')
}

const md = (front: string, body: string) => `---\n${front}\n---\n\n${body}\n`

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'plugin-validate-'))
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('validatePlugin', () => {
  it('warns when the manifest name does not match its directory', async () => {
    const plugin = await writePlugin('totally-different', 'my-folder', {})
    const { errors, warnings } = validatePlugin(plugin)
    expect(errors).toHaveLength(0)
    expect(
      warnings.some((w) => w.includes('"totally-different"') && w.includes('"my-folder"')),
    ).toBe(true)
  })

  it('does not warn on a matching directory name', async () => {
    const plugin = await writePlugin('matching', 'matching', {})
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes("doesn't match its directory"))).toBe(false)
  })

  it("does not warn about the directory of a plugin in Claude Code's versioned cache", async () => {
    const plugin = await writePlugin('tokendoctor', 'cache/mkt/tokendoctor/0.4.0', {})
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes("doesn't match its directory"))).toBe(false)
    // Only that layout: the same version folder elsewhere is still a mismatch.
    const elsewhere = await writePlugin('tokendoctor', 'other/tokendoctor/0.4.0', {})
    expect(
      validatePlugin(elsewhere).warnings.some((w) => w.includes("doesn't match its directory")),
    ).toBe(true)
  })

  it('warns when a prompt references a placeholder no argument names', async () => {
    const plugin = await writePlugin('cmds2', 'cmds2', {
      commands: { go: { description: 'go', content: 'Use ${mystery} here.' } },
    })
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('${mystery}'))).toBe(true)
  })

  it('warns when an agent role name repeats the plugin prefix', async () => {
    const plugin = await writePlugin(
      'prefixed',
      'prefixed',
      {},
      { 'agents/auditor.md': md('name: prefixed:auditor\ndescription: audits', 'You audit.') },
    )
    const { warnings } = validatePlugin(plugin)
    expect(
      warnings.some((w) => w.includes('repeats the plugin prefix') && w.includes('"auditor"')),
    ).toBe(true)
  })

  it('accepts a well-formed agent role', async () => {
    const plugin = await writePlugin(
      'goodrole',
      'goodrole',
      { description: 'A plugin with one agent.' },
      {
        'agents/auditor.md': md(
          'name: auditor\ndescription: audits\ntools: Read, Grep, Bash',
          'You audit.',
        ),
      },
    )
    const { errors, warnings } = validatePlugin(plugin)
    expect(errors).toHaveLength(0)
    expect(warnings.some((w) => w.toLowerCase().includes('agent role'))).toBe(false)
  })

  it('does not warn on Claude Code tool names a command allows (they map to engine tools)', async () => {
    const plugin = await writePlugin(
      'cmd-tools',
      'cmd-tools',
      {},
      { 'commands/run.md': md('description: Run it\nallowed-tools: Bash Read', 'Do it.') },
    )
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('"bash"'))).toBe(false) // bash is a known engine tool
    expect(warnings.some((w) => w.includes('"read"'))).toBe(false) // read is a known engine tool
  })

  it('warns on an MCP tool an agent disallows: it applies only when a server provides it', async () => {
    const plugin = await writePlugin(
      'badblock',
      'badblock',
      {},
      {
        'agents/worker.md': md(
          'name: worker\ndescription: works\ndisallowedTools: Bash, mcp__acme__board',
          'work.',
        ),
      },
    )
    const { warnings } = validatePlugin(plugin)
    // 'bash' is a known engine tool — no warning
    expect(warnings.some((w) => w.includes('"bash"'))).toBe(false)
    expect(
      warnings.some((w) => w.includes('"mcp_acme_board"') && w.includes('plugin or MCP server')),
    ).toBe(true)
  })

  it('names an MCP tool an agent lists as not a built-in, without calling it ignored', async () => {
    const plugin = await writePlugin(
      'roletools',
      'roletools',
      {},
      {
        'agents/worker.md': md(
          'name: worker\ndescription: works\ntools: Read, mcp__acme__board',
          'work.',
        ),
      },
    )
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('"read"'))).toBe(false)
    const mcpTool = warnings.find((w) => w.includes('"mcp_acme_board"'))
    // The defect: this used to say the tool "will be ignored", which a closed profile disproves.
    expect(mcpTool).toContain('applies only when an enabled plugin or MCP server provides it')
    expect(mcpTool).not.toContain('ignored')
  })

  it('does not flag SCREAMING_CASE tokens (config/env documentation) as arg typos', async () => {
    const plugin = await writePlugin('cmds4', 'cmds4', {
      commands: { go: { content: 'Substitute ${API_KEY} from config.' } },
    })
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('${API_KEY}'))).toBe(false)
  })

  it('warns on command with empty description + agent with empty description', async () => {
    const plugin = await writePlugin(
      'nodesc2',
      'nodesc2',
      { commands: { run: { content: 'Go.' } } },
      { 'agents/worker.md': md('name: worker', 'Work.') },
    )
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('Command "run"') && w.includes('no description'))).toBe(
      true,
    )
    expect(
      warnings.some((w) => w.includes('Agent role "worker"') && w.includes('no description')),
    ).toBe(true)
  })

  it('warns on a credential-looking option not marked sensitive, naming Claude Code’s field', async () => {
    const plugin = await writePlugin('cred-config', 'cred-config', {
      userConfig: {
        BOT_TOKEN: { type: 'string', title: 'Bot token', description: 'The bot token.' },
      },
    })
    const { warnings } = validatePlugin(plugin)
    const warning = warnings.find((w) => w.includes('"BOT_TOKEN"') && w.includes('credential'))
    expect(warning).toBeDefined()
    // `userConfig` options are strict: a `secret` key would stop the plugin from loading.
    expect(warning).toContain('"sensitive": true')
    expect(warning).not.toContain('"secret')
  })

  it('warns when the manifest has no description', async () => {
    const plugin = await writePlugin('nodesc', 'nodesc', { description: '' })
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('no description'))).toBe(true)
  })

  it('warns on a field Claude Code does not know', async () => {
    const plugin = await writePlugin('unknown-plugin', 'unknown-plugin', {
      completelymadeupfield: 'x',
    })
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('Unknown field "completelymadeupfield"'))).toBe(true)
  })

  it('warns that top-level monitors belong under experimental, and loads them', async () => {
    const plugin = await writePlugin('cc-monitors', 'cc-monitors', {
      monitors: [{ name: 'watch', command: 'echo hi' }],
    })
    expect(plugin.entrypoints.monitors.map((monitor) => monitor.name)).toEqual(['watch'])
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('"monitors" belongs under "experimental"'))).toBe(true)
  })

  it('is silent about experimental.monitors (honored, not ignored)', async () => {
    const plugin = await writePlugin('cc-exp-monitors', 'cc-exp-monitors', {
      experimental: { monitors: [{ name: 'watch', command: 'echo hi' }] },
    })
    expect(plugin.entrypoints.monitors.map((monitor) => monitor.name)).toEqual(['watch'])
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('monitors'))).toBe(false)
  })

  it('silently accepts $schema without a warning', async () => {
    const plugin = await writePlugin('schema-plugin', 'schema-plugin', {
      $schema: 'https://json.schemastore.org/...',
    })
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('schema'))).toBe(false)
  })
})

describe('validatePlugin — sensitive keys in MCP config', () => {
  const userConfig = {
    SECRET: { type: 'string', title: 'Secret', sensitive: true, description: 'a credential' },
    REGION: { type: 'string', title: 'Region', description: 'a region' },
  }

  it('does NOT warn when a sensitive key is referenced in args/url/headers (it substitutes there)', async () => {
    const plugin = await writePlugin('mcp-secret-out', 'mcp-secret-out', {
      userConfig,
      mcpServers: {
        a: { command: 'node', args: ['--key=${SECRET}'], env: { TOKEN: '${SECRET}' } },
        b: { url: 'https://x.example', headers: { Authorization: 'Bearer ${user_config.SECRET}' } },
      },
    })
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('SECRET') || w.includes('user_config'))).toBe(false)
  })

  it('warns when a headersHelper references ${user_config.*} (it runs through a shell)', async () => {
    const plugin = await writePlugin('mcp-helper', 'mcp-helper', {
      userConfig,
      mcpServers: {
        api: { url: 'https://x.example', headersHelper: './auth.sh ${user_config.REGION}' },
      },
    })
    const { warnings } = validatePlugin(plugin)
    const hits = warnings.filter((w) => w.includes('MCP server "api"'))
    expect(hits).toHaveLength(1)
    expect(hits[0]).toContain('"headersHelper"')
  })
})

describe('validatePlugin — sensitive keys in hook commands', () => {
  const userConfig = {
    SECRET: { type: 'string', title: 'Secret', sensitive: true, description: 'a credential' },
    REGION: { type: 'string', title: 'Region', description: 'a region' },
  }

  it('warns when a hook command references a sensitive ${user_config.KEY} (shell strings never substitute secrets)', async () => {
    const plugin = await writePlugin('hook-secret', 'hook-secret', {
      userConfig,
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'notify --token ${user_config.SECRET}' }] }],
      },
    })
    const { warnings } = validatePlugin(plugin)
    const hits = warnings.filter(
      (w) => w.includes('sensitive key "${user_config.SECRET}"') && w.includes('Hook command'),
    )
    expect(hits).toHaveLength(1)
    expect(hits[0]).toContain('environment')
  })

  it('does NOT warn for non-sensitive keys or bare shell vars in hook commands', async () => {
    const plugin = await writePlugin('hook-secret-ok', 'hook-secret-ok', {
      userConfig,
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: 'deploy --region ${user_config.REGION} --home ${HOME}' },
            ],
          },
        ],
      },
    })
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('Hook command references sensitive key'))).toBe(false)
  })
})

describe('validateCompatibility', () => {
  it('does not warn on the Claude Code components Localix runs', async () => {
    const plugin = await writePlugin('cc-fields', 'cc-fields', {
      outputStyles: './output-styles/',
      workflows: './workflows/',
      experimental: { themes: './themes/' },
      settings: { agent: 'reviewer' },
    })
    const { warnings } = validateCompatibility(plugin)
    expect(warnings.filter((w) => w.includes('ignores') || w.includes('Unrecognized'))).toEqual([])
  })

  it('does NOT warn that hooks / lspServers are ignored (they are now supported)', async () => {
    const plugin = await writePlugin('cc-supported', 'cc-supported', {
      lspServers: { go: { command: 'gopls', extensionToLanguage: { '.go': 'go' } } },
      hooks: './hooks/hooks.json',
    })
    const { warnings } = validateCompatibility(plugin)
    expect(warnings.some((w) => w.includes('"lspServers"') && w.includes('ignores'))).toBe(false)
    expect(warnings.some((w) => w.includes('"hooks"') && w.includes('ignored'))).toBe(false)
  })

  it('a clean plugin with a `hooks` key has no warning, so --strict passes it', async () => {
    const plugin = await writePlugin('cc-hooks-clean', 'cc-hooks-clean', {
      description: 'Formats files.',
      hooks: './hooks/hooks.json',
    })
    expect(validateCompatibility(plugin).warnings).toEqual([])
  })

  it('does not warn on the Claude Code file-path layout for commands/agents (both load now)', async () => {
    const plugin = await writePlugin('cc-layout', 'cc-layout', {
      commands: ['./commands/deploy.md'],
      agents: ['./agents/reviewer.md'],
    })
    const { warnings } = validateCompatibility(plugin)
    expect(warnings.some((w) => w.includes('inline agent-role'))).toBe(false)
    expect(warnings.some((w) => w.includes('inline command'))).toBe(false)
  })

  it('warns on path traversal in a string path field', async () => {
    const plugin = await writePlugin('trav', 'trav', { skills: '../../evil' })
    const { warnings } = validateCompatibility(plugin)
    expect(warnings.some((w) => w.includes('..') && w.includes('"skills"'))).toBe(true)
  })

  it('warns on a non-kebab-case name', async () => {
    const plugin = await writePlugin('Not_Kebab', 'Not_Kebab', {})
    const { warnings } = validateCompatibility(plugin)
    expect(warnings.some((w) => w.includes('kebab-case'))).toBe(true)
  })

  it('is silent for a clean manifest', async () => {
    const plugin = await writePlugin('clean-plugin', 'clean-plugin', {
      description: 'fine',
      commands: { go: { content: 'do it' } },
    })
    const { errors, warnings } = validateCompatibility(plugin)
    expect(errors).toHaveLength(0)
    expect(warnings).toHaveLength(0)
  })
})
