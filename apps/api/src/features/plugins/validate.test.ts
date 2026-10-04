import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { loadManifest } from './discovery'
import { validateCompatibility } from './validate-compat'
import { validatePlugin } from './validate'
import { CC_HOOK_EVENTS } from '../cc-hooks/contracts'

let dir: string

async function writePlugin(name: string, dirName: string, manifest: Record<string, unknown>) {
  const pluginDir = join(dir, dirName)
  await fs.mkdir(pluginDir, { recursive: true })
  await fs.writeFile(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({ name, apiVersion: 1, ...manifest }),
  )
  return loadManifest(pluginDir, 'global', '')
}

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

  it('warns when a manifest has no SPDX license identifier', async () => {
    const plugin = await writePlugin('unlicensed', 'unlicensed', {
      description: 'A fixture plugin.',
      author: 'Fixture',
      version: '1.0.0',
    })
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((warning) => warning.includes('Manifest has no license'))).toBe(true)
  })

  it('warns when a command declares an arg its prompt never references', async () => {
    const plugin = await writePlugin('cmds', 'cmds', {
      commands: [
        { name: 'go', args: [{ name: 'query' }], prompt: 'Do something without the arg.' },
      ],
    })
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('declares arg "query"'))).toBe(true)
  })

  it('flags a promptSection as a compatibility path steering dynamic context to a Context Fabric provider', async () => {
    const plugin = await writePlugin('promptsec', 'promptsec', {
      promptSections: [{ title: 'Guidance', content: 'Always be concise.' }],
    })
    const { warnings } = validatePlugin(plugin)
    expect(
      warnings.some((w) => w.includes('Context Fabric provider') && w.includes('contextProviders')),
    ).toBe(true)
  })

  it('warns when a prompt references a placeholder with no declared arg', async () => {
    const plugin = await writePlugin('cmds2', 'cmds2', {
      commands: [{ name: 'go', args: [], prompt: 'Use ${mystery} here.' }],
    })
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('${mystery}'))).toBe(true)
  })

  it('errors on duplicate command names (they would shadow each other)', async () => {
    const plugin = await writePlugin('dupcmds', 'dupcmds', {
      commands: [
        { name: 'go', args: [], prompt: 'first' },
        { name: 'go', args: [], prompt: 'second' },
      ],
    })
    const { errors } = validatePlugin(plugin)
    expect(
      errors.some((e) => e.includes('Duplicate command "go"') && e.includes('dupcmds:go')),
    ).toBe(true)
  })

  it('does not flag distinctly-named commands as duplicates', async () => {
    const plugin = await writePlugin('okcmds', 'okcmds', {
      commands: [
        { name: 'a', args: [], prompt: 'first' },
        { name: 'b', args: [], prompt: 'second' },
      ],
    })
    const { errors } = validatePlugin(plugin)
    expect(errors.some((e) => e.includes('Duplicate command'))).toBe(false)
  })

  it('errors on duplicate view ids — including ones promoted from legacy panels', async () => {
    const plugin = await writePlugin('dups', 'dups', {
      views: [{ id: 'board', title: 'A', file: 'a.html' }],
      panels: [{ name: 'board', title: 'B', file: 'b.html' }],
    })
    const { errors } = validatePlugin(plugin)
    expect(errors.some((e) => e.includes('Duplicate view "board"'))).toBe(true)
  })

  it('errors on duplicate agent role names and warns on an unknown tool', async () => {
    const plugin = await writePlugin('roles', 'roles', {
      agents: [
        { name: 'dup', prompt: 'a', tools: ['read', 'frobnicate'] },
        { name: 'dup', prompt: 'b' },
      ],
    })
    const { errors, warnings } = validatePlugin(plugin)
    expect(errors.some((e) => e.includes('Duplicate agent role "dup"'))).toBe(true)
    expect(
      warnings.some((w) => w.includes('"frobnicate"') && w.includes('not a built-in tool')),
    ).toBe(true)
  })

  it('warns when an agent role name repeats the plugin prefix', async () => {
    const plugin = await writePlugin('prefixed', 'prefixed', {
      agents: [{ name: 'prefixed:auditor', description: 'audits', prompt: 'You audit.' }],
    })
    const { warnings } = validatePlugin(plugin)
    expect(
      warnings.some((w) => w.includes('repeats the plugin prefix') && w.includes('"auditor"')),
    ).toBe(true)
  })

  it('accepts a well-formed agent role', async () => {
    const plugin = await writePlugin('goodrole', 'goodrole', {
      agents: [
        {
          name: 'auditor',
          description: 'audits',
          prompt: 'You audit.',
          tools: ['read', 'search', 'bash'],
        },
      ],
    })
    const { errors, warnings } = validatePlugin(plugin)
    expect(errors).toHaveLength(0)
    expect(warnings.some((w) => w.toLowerCase().includes('agent role'))).toBe(false)
  })

  it('warns on unknown allowedTools in a command (only non-CC engine names)', async () => {
    // CC names (Bash, Grep) are mapped to engine names and never trigger the warning.
    // Engine names that don't exist (e.g. 'invalid-tool') were dropped by CC_TOOL_NAME_MAP.
    // A warning fires if somehow an unmapped name survived and appears in allowedTools.
    // Simplest way to test: use valid engine names only → no warnings.
    const plugin = await writePlugin('cmd-tools', 'cmd-tools', {
      commands: [{ name: 'run', args: [], prompt: 'Do it.', allowedTools: ['bash', 'read'] }],
    })
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('"bash"'))).toBe(false) // bash is a known engine tool
    expect(warnings.some((w) => w.includes('"read"'))).toBe(false) // read is a known engine tool
  })

  it('warns on unknown disallowedTools in an agent role', async () => {
    const plugin = await writePlugin('badblock', 'badblock', {
      agents: [{ name: 'worker', prompt: 'work.', disallowedTools: ['bash', 'fake-tool'] }],
    })
    const { warnings } = validatePlugin(plugin)
    // 'bash' is a known engine tool — no warning
    expect(warnings.some((w) => w.includes('"bash"'))).toBe(false)
    // 'fake-tool' is not a built-in — warned, as depending on a plugin or MCP server
    expect(
      warnings.some((w) => w.includes('"fake-tool"') && w.includes('plugin or MCP server')),
    ).toBe(true)
  })

  it('names a capitalized built-in as a typo, and a plugin tool as not a built-in', async () => {
    const plugin = await writePlugin('roletools', 'roletools', {
      agents: [{ name: 'worker', prompt: 'work.', tools: ['Read', 'acme_board'] }],
    })
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('"Read"') && w.includes('use "read"'))).toBe(true)
    const pluginTool = warnings.find((w) => w.includes('"acme_board"'))
    // The defect: this used to say the tool "will be ignored", which a closed profile disproves.
    expect(pluginTool).toContain('applies only when an enabled plugin or MCP server provides it')
    expect(pluginTool).not.toContain('ignored')
  })

  it('does not flag SCREAMING_CASE tokens (config/env documentation) as arg typos', async () => {
    const plugin = await writePlugin('cmds4', 'cmds4', {
      commands: [{ name: 'go', args: [], prompt: 'Substitute ${API_KEY} from config.' }],
    })
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('${API_KEY}'))).toBe(false)
  })

  it('warns on command with empty description + agent with empty description', async () => {
    const plugin = await writePlugin('nodesc2', 'nodesc2', {
      commands: [{ name: 'run', args: [], prompt: 'Go.', description: '' }],
      agents: [{ name: 'worker', prompt: 'Work.', description: '' }],
    })
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('Command "run"') && w.includes('no description'))).toBe(
      true,
    )
    expect(
      warnings.some((w) => w.includes('Agent role "worker"') && w.includes('no description')),
    ).toBe(true)
  })

  it('warns when required arg follows optional arg', async () => {
    const plugin = await writePlugin('argorder', 'argorder', {
      commands: [
        {
          name: 'cmd',
          description: 'cmd',
          args: [
            { name: 'opt', type: 'text', required: false },
            { name: 'req', type: 'text', required: true },
          ],
          prompt: 'Do ${opt} and ${req}.',
        },
      ],
    })
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('"req"') && w.includes('required'))).toBe(true)
  })

  it('warns on credential-looking config not marked secret', async () => {
    const plugin = await writePlugin('cred-config', 'cred-config', {
      config: { BOT_TOKEN: { type: 'string', description: 'The bot token.' } },
    })
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('"BOT_TOKEN"') && w.includes('credential'))).toBe(true)
  })

  it('warns when the manifest has no description', async () => {
    const plugin = await writePlugin('nodesc', 'nodesc', { description: '' })
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('no description'))).toBe(true)
  })

  it('warns when the manifest has no author or explicit version', async () => {
    // No author → warn; no version in rawManifest (only schema default) → warn.
    const plugin = await writePlugin('noauthor', 'noauthor', {})
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('author'))).toBe(true)
    expect(warnings.some((w) => w.includes('version'))).toBe(true)
  })

  it('does not warn about author or version when both are declared', async () => {
    const plugin = await writePlugin('fullmeta', 'fullmeta', { author: 'Dev', version: '1.2.0' })
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('author'))).toBe(false)
    expect(warnings.some((w) => w.includes('version'))).toBe(false)
  })

  it('accepts a command whose args and placeholders line up', async () => {
    const plugin = await writePlugin('cmds3', 'cmds3', {
      commands: [
        {
          name: 'go',
          description: 'Search for a query',
          args: [{ name: 'query' }],
          prompt: 'Search for ${query}.',
        },
      ],
    })
    const { warnings } = validatePlugin(plugin)
    // No arg-related warnings — only description + arg cross-reference checks
    expect(
      warnings.filter((w) => w.includes('never references') || w.includes("isn't a declared arg")),
    ).toHaveLength(0)
  })

  it('recognizes dashed arg placeholders supported by the command schema and renderer', async () => {
    const plugin = await writePlugin('dashed-args', 'dashed-args', {
      commands: [
        {
          name: 'go',
          description: 'Run against a project',
          args: [{ name: 'project-name' }],
          prompt: 'Run against ${project-name}.',
        },
      ],
    })
    const { warnings } = validatePlugin(plugin)

    expect(warnings.some((warning) => warning.includes('project-name'))).toBe(false)
  })

  it('validates conditional args against an earlier choice without a false order warning', async () => {
    const plugin = await writePlugin('conditional-args', 'conditional-args', {
      commands: [
        {
          name: 'go',
          description: 'Conditionally deploy',
          args: [
            {
              name: 'action',
              type: 'choice',
              required: false,
              options: [{ value: 'deploy' }, { value: 'inspect' }],
            },
            {
              name: 'target',
              type: 'text',
              required: true,
              when: { arg: 'action', equals: 'deploy' },
            },
          ],
          prompt: 'Do ${action} for ${target}.',
        },
      ],
    })
    const { errors, warnings } = validatePlugin(plugin)

    expect(errors).toHaveLength(0)
    expect(warnings.some((warning) => warning.includes('required args must come before'))).toBe(
      false,
    )
  })

  it('rejects conditional args that reference a later, missing, or non-choice arg', async () => {
    const plugin = await writePlugin('bad-conditions', 'bad-conditions', {
      commands: [
        {
          name: 'go',
          description: 'Invalid conditions',
          args: [
            { name: 'first', when: { arg: 'later', equals: 'x' } },
            { name: 'later', type: 'choice', options: [{ value: 'x' }] },
            { name: 'text-parent', type: 'text' },
            { name: 'child', when: { arg: 'text-parent', equals: 'x' } },
            { name: 'orphan', when: { arg: 'missing', equals: 'x' } },
          ],
          prompt: '${first} ${later} ${text-parent} ${child} ${orphan}',
        },
      ],
    })
    const { errors } = validatePlugin(plugin)

    expect(errors.some((error) => error.includes('conditions must reference an earlier arg'))).toBe(
      true,
    )
    expect(errors.some((error) => error.includes('conditions require an earlier choice arg'))).toBe(
      true,
    )
    expect(errors.some((error) => error.includes('depends on unknown arg "missing"'))).toBe(true)
  })
})

describe('validatePlugin — dynamic arg optionsScript', () => {
  it('a dynamic choice (optionsScript, no static options) skips the "no options" warning; warns if the file is missing', async () => {
    const plugin = await writePlugin('dyn1', 'dyn1', {
      commands: [
        {
          name: 'go',
          description: 'go',
          args: [{ name: 'ref', type: 'choice', optionsScript: './src/refs.ts' }],
          prompt: 'Use ${ref}.',
        },
      ],
    })
    const { errors, warnings } = validatePlugin(plugin)
    expect(errors).toHaveLength(0)
    expect(warnings.some((w) => w.includes('declares no options'))).toBe(false)
    expect(warnings.some((w) => w.includes('optionsScript') && w.includes('not found'))).toBe(true)
  })

  it('no missing-file warning once the script exists', async () => {
    const plugin = await writePlugin('dyn2', 'dyn2', {
      commands: [
        {
          name: 'go',
          description: 'go',
          args: [{ name: 'ref', type: 'choice', optionsScript: './src/refs.ts' }],
          prompt: 'Use ${ref}.',
        },
      ],
    })
    await fs.mkdir(join(dir, 'dyn2', 'src'), { recursive: true })
    await fs.writeFile(join(dir, 'dyn2', 'src', 'refs.ts'), 'console.log("[]")')
    const { errors, warnings } = validatePlugin(plugin)
    expect(errors).toHaveLength(0)
    expect(warnings.some((w) => w.includes('not found'))).toBe(false)
  })

  it('errors when both optionsScript and static options are declared', async () => {
    const plugin = await writePlugin('dyn3', 'dyn3', {
      commands: [
        {
          name: 'go',
          description: 'go',
          args: [
            {
              name: 'ref',
              type: 'choice',
              optionsScript: './src/refs.ts',
              options: [{ value: 'a' }],
            },
          ],
          prompt: 'Use ${ref}.',
        },
      ],
    })
    const { errors } = validatePlugin(plugin)
    expect(errors.some((e) => e.includes('BOTH') && e.includes('optionsScript'))).toBe(true)
  })

  it('errors when optionsScript is on a non-choice arg', async () => {
    const plugin = await writePlugin('dyn4', 'dyn4', {
      commands: [
        {
          name: 'go',
          description: 'go',
          args: [{ name: 'ref', type: 'text', optionsScript: './src/refs.ts' }],
          prompt: 'Use ${ref}.',
        },
      ],
    })
    const { errors } = validatePlugin(plugin)
    expect(errors.some((e) => e.includes('only apply to a "choice"'))).toBe(true)
  })

  it('errors when optionsScript escapes the plugin directory', async () => {
    const plugin = await writePlugin('dyn5', 'dyn5', {
      commands: [
        {
          name: 'go',
          description: 'go',
          args: [{ name: 'ref', type: 'choice', optionsScript: '../../evil.ts' }],
          prompt: 'Use ${ref}.',
        },
      ],
    })
    const { errors } = validatePlugin(plugin)
    expect(errors.some((e) => e.includes('escapes the plugin directory'))).toBe(true)
  })
})

describe('validatePlugin — sensitive keys in MCP config', () => {
  const config = {
    SECRET: { type: 'string', secret: true, description: 'a credential' },
    REGION: { type: 'string', description: 'a region' },
  }

  it('warns when a sensitive key is referenced outside "env" (args/url/headers)', async () => {
    const plugin = await writePlugin('mcp-secret-out', 'mcp-secret-out', {
      config,
      mcpServers: {
        a: { command: 'node', args: ['--key=${SECRET}'] },
        b: { url: 'https://x.example', headers: { Authorization: 'Bearer ${user_config.SECRET}' } },
      },
    })
    const { warnings } = validatePlugin(plugin)
    const hits = warnings.filter((w) => w.includes('sensitive key "${SECRET}"'))
    expect(hits).toHaveLength(1)
    expect(hits[0]).toContain('"env"')
  })

  it('does NOT warn when the sensitive key stays inside "env" or when a non-sensitive key is used anywhere', async () => {
    const plugin = await writePlugin('mcp-secret-ok', 'mcp-secret-ok', {
      config,
      mcpServers: {
        a: {
          command: 'node',
          args: ['--region=${REGION}'],
          env: { TOKEN: '${SECRET}' },
        },
      },
    })
    const { warnings } = validatePlugin(plugin)
    expect(warnings.some((w) => w.includes('sensitive key'))).toBe(false)
  })
})

describe('validatePlugin — sensitive keys in hook commands', () => {
  const config = {
    SECRET: { type: 'string', secret: true, description: 'a credential' },
    REGION: { type: 'string', description: 'a region' },
  }

  it('warns when a hook command references a sensitive ${user_config.KEY} (shell strings never substitute secrets)', async () => {
    const plugin = await writePlugin('hook-secret', 'hook-secret', {
      config,
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
      config,
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
  it('warns on Claude Code fields this host still ignores (outputStyles)', async () => {
    const plugin = await writePlugin('cc-fields', 'cc-fields', {
      outputStyles: './output-styles/',
    })
    const { warnings } = validateCompatibility(plugin)
    expect(warnings.some((w) => w.includes('"outputStyles"') && w.includes('ignores'))).toBe(true)
  })

  it('promotes experimental.monitors to top-level monitors (honored, not ignored)', async () => {
    const plugin = await writePlugin('cc-monitors', 'cc-monitors', {
      experimental: { monitors: [{ name: 'watch', command: 'echo hi' }] },
    })
    const { warnings } = validateCompatibility(plugin)
    // The old "monitors is declared but this host ignores it" warning is gone.
    expect(warnings.some((w) => w.includes('"monitors"') && w.includes('ignores'))).toBe(false)
    expect(warnings.some((w) => w.includes('"monitors"') && w.includes('promoted'))).toBe(true)
  })

  it('does NOT warn that hooks / lspServers are ignored (they are now supported)', async () => {
    const plugin = await writePlugin('cc-supported', 'cc-supported', {
      lspServers: { go: { command: 'gopls', extensionToLanguage: { '.go': 'go' } } },
      hooks: './hooks/hooks.json',
    })
    const { warnings } = validateCompatibility(plugin)
    // hooks still gets an advisory (which events this host dispatches), but not "ignored".
    expect(warnings.some((w) => w.includes('"lspServers"') && w.includes('ignores'))).toBe(false)
    expect(warnings.some((w) => w.includes('"hooks"') && w.includes('ignored'))).toBe(false)
  })

  it('the hooks advisory states all 5 handler types run and lists exactly the dispatched events', async () => {
    const plugin = await writePlugin('cc-hooks-adv', 'cc-hooks-adv', {
      hooks: './hooks/hooks.json',
    })
    const { warnings } = validateCompatibility(plugin)
    const advisory = warnings.find((w) => w.includes('"hooks"'))
    expect(advisory).toBeDefined()
    // All five handler types execute — the old command-only claim must be gone.
    for (const t of ['command', 'http', 'mcp_tool', 'prompt', 'agent']) {
      expect(advisory).toContain(t)
    }
    expect(advisory).not.toContain('only type:"command"')
    // The event list is derived from the cc-hooks engine — assert parity with it.
    for (const event of CC_HOOK_EVENTS) {
      expect(advisory).toContain(event)
    }
    // Genuinely undispatched CC events are what the warning is scoped to.
    expect(advisory).toContain('never fire')
  })

  it('warns that userConfig was auto-mapped to config', async () => {
    const plugin = await writePlugin('uc', 'uc', { userConfig: { token: { type: 'string' } } })
    const { warnings } = validateCompatibility(plugin)
    expect(warnings.some((w) => w.includes('"userConfig"') && w.includes('config'))).toBe(true)
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

  it('warns on an unrecognized field and suggests a close match', async () => {
    // "hompage" is 1 char off from "homepage" — expect a suggestion.
    const plugin = await writePlugin('typo-plugin', 'typo-plugin', {
      hompage: 'https://example.com',
    })
    const { warnings } = validateCompatibility(plugin)
    expect(warnings.some((w) => w.includes('"hompage"') && w.includes('"homepage"'))).toBe(true)
  })

  it('warns on a completely unknown field without a suggestion', async () => {
    const plugin = await writePlugin('unknown-plugin', 'unknown-plugin', {
      completelymadeupfield: 'x',
    })
    const { warnings } = validateCompatibility(plugin)
    expect(
      warnings.some((w) => w.includes('"completelymadeupfield"') && w.includes('will be ignored')),
    ).toBe(true)
  })

  it('warns on marketplace-only fields appearing in plugin.json (copy-paste from catalog)', async () => {
    const plugin = await writePlugin('mkt-plugin', 'mkt-plugin', {
      source: './my-plugin',
      strict: true,
    })
    const { warnings } = validateCompatibility(plugin)
    expect(warnings.some((w) => w.includes('"source"') && w.includes('marketplace'))).toBe(true)
    // Should NOT also produce "unrecognized field" warning for these
    expect(warnings.some((w) => w.includes('"source"') && w.includes('Unrecognized'))).toBe(false)
  })

  it('accepts a launcher category in plugin.json without a compatibility warning', async () => {
    const plugin = await writePlugin('categorized', 'categorized', { category: 'data' })
    expect(validateCompatibility(plugin).warnings).toEqual([])
  })

  it('silently accepts $schema without a warning', async () => {
    const plugin = await writePlugin('schema-plugin', 'schema-plugin', {
      $schema: 'https://json.schemastore.org/...',
    })
    const { warnings } = validateCompatibility(plugin)
    expect(warnings.some((w) => w.includes('schema'))).toBe(false)
  })

  it('is silent for a clean native manifest', async () => {
    const plugin = await writePlugin('clean-plugin', 'clean-plugin', {
      description: 'fine',
      commands: [{ name: 'go', args: [], prompt: 'do it' }],
    })
    const { errors, warnings } = validateCompatibility(plugin)
    expect(errors).toHaveLength(0)
    expect(warnings).toHaveLength(0)
  })
})

describe('the removed `contributes` declaration', () => {
  it('warns that the block is inert, so a stale manifest does not look load-bearing', async () => {
    const plugin = await writePlugin('stale-declaration', 'stale-declaration', {
      contributes: {
        tools: [{ name: 'write_thing', description: 'Writes a thing.' }],
        hooks: [],
        backends: [],
        channels: [],
        memory: null,
      },
    })
    const { warnings } = validateCompatibility(plugin)
    expect(warnings.some((warning) => warning.includes('"contributes"'))).toBe(true)
    // Not the generic "unrecognized field" line — the author needs to know it USED to work.
    expect(warnings.some((warning) => warning.includes('read from the plugin module'))).toBe(true)
  })
})

describe('recognized manifest fields', () => {
  it('recognizes `views`, which is implemented, routed and documented', async () => {
    // It was missing from the known-field list only, so the validator told authors a working
    // feature would be ignored.
    const plugin = await writePlugin('with-views', 'with-views', {
      views: [{ id: 'dashboard', title: 'Dashboard', file: './views/d.html' }],
    })
    const { warnings } = validateCompatibility(plugin)
    expect(warnings.some((warning) => warning.includes('"views"'))).toBe(false)
  })

  it('warns that a legacy `panels` array is loaded as views, without calling it unknown', async () => {
    const plugin = await writePlugin('with-panels', 'with-panels', {
      panels: [{ name: 'board', title: 'Board', file: './panels/board.html' }],
    })
    const { warnings } = validateCompatibility(plugin)
    expect(warnings.some((w) => w.includes('Unrecognized manifest field "panels"'))).toBe(false)
    expect(warnings.some((w) => w.includes('"panels" is the former name of "views"'))).toBe(true)
  })
})
