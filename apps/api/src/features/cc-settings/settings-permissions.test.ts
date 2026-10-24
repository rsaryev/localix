import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { readSettingsLayers } from './settings-files'
import {
  settingsPermissionDecision,
  settingsPermissionRules,
  settingsRemoveTool,
  type CcCallFacts,
} from './settings-permissions'

/**
 * A person's Claude Code permission rules, written in their own settings files, decide a Localix
 * call as they decide it in Claude Code (permissions.md).
 */
const scratch = tempDirPerTest('cc-permissions-')

async function rulesFor(tree: Record<string, string>, options: { projectTrusted?: boolean } = {}) {
  const root = scratch()
  writeTree(root, tree)
  const layers = await readSettingsLayers({
    homeDir: join(root, 'home'),
    cwd: join(root, 'project'),
    env: {},
    managed: { dir: join(root, 'managed') },
  })
  const rules = settingsPermissionRules(layers, { projectTrusted: options.projectTrusted ?? true })
  const decide = (call: Partial<CcCallFacts> & { toolName: string }) =>
    settingsPermissionDecision(rules, {
      input: {},
      paths: [],
      writes: [],
      cwd: join(root, 'project'),
      homeDir: join(root, 'home'),
      ...call,
    })?.effect
  return { root, rules, decide }
}

const settings = (permissions: Record<string, string[]>, extra: object = {}) =>
  JSON.stringify({ permissions, ...extra })
const bash = (command: string) => ({ toolName: 'bash', input: { command }, commands: [command] })

describe('Claude Code permission rules from settings files', () => {
  test('a deny in any file beats an allow in any other, whatever the order', async () => {
    const { decide } = await rulesFor({
      'home/.claude/settings.json': settings({ allow: ['Bash(git *)'] }),
      'project/.claude/settings.json': settings({ deny: ['Bash(git push *)'] }),
    })
    expect(decide(bash('git push origin main'))).toBe('deny')
    expect(decide(bash('git status'))).toBe('allow')
    expect(decide(bash('npm test'))).toBeUndefined()
  })

  test("an ask in the team's file still asks when the person's local file allows", async () => {
    const { decide } = await rulesFor({
      'project/.claude/settings.json': settings({ ask: ['Bash(npm publish *)'] }),
      'project/.claude/settings.local.json': settings({ allow: ['Bash(npm *)'] }),
    })
    expect(decide(bash('npm publish --tag next'))).toBe('ask')
    expect(decide(bash('npm install'))).toBe('allow')
  })

  test('an allow covers every subcommand; a deny catches any, past wrappers and assignments', async () => {
    const { decide } = await rulesFor({
      'home/.claude/settings.json': settings({
        allow: ['Bash(npm run *)'],
        deny: ['Bash(rm *)'],
      }),
    })
    expect(decide(bash('npm run build'))).toBe('allow')
    expect(decide(bash('timeout 30 npm run build'))).toBe('allow')
    expect(decide(bash('npm run build && curl x'))).toBeUndefined()
    expect(decide(bash('cd /tmp && rm -rf build'))).toBe('deny')
    expect(decide(bash('FOO=bar rm -rf tmp'))).toBe('deny')
    expect(decide(bash('nohup rm -rf tmp'))).toBe('deny')
    expect(decide(bash('echo "$(rm -rf tmp)"'))).toBe('deny')
  })

  test('Read and Edit paths anchor as Claude Code anchors them', async () => {
    const { root, decide } = await rulesFor({
      'home/.claude/settings.json': settings({
        deny: ['Read(/secrets/**)', 'Read(~/.aws/**)', 'Edit(//etc/**)'],
      }),
      'project/.claude/settings.json': settings({
        deny: ['Read(.env)', 'Read(*.pem)', 'Read(!sample.pem)'],
        allow: ['Edit(src/**)'],
      }),
    })
    const project = join(root, 'project')
    const home = join(root, 'home')
    const read = (path: string) => decide({ toolName: 'read', paths: [path] })
    // A bare name at any depth under the working directory, never above it.
    expect(read(join(project, '.env'))).toBe('deny')
    expect(read(join(project, 'apps/api/.env'))).toBe('deny')
    expect(read(join(root, '.env'))).toBeUndefined()
    // `/path` in user settings is the configuration directory's, not the project's.
    expect(read(join(home, '.claude/secrets/key'))).toBe('deny')
    expect(read(join(project, 'secrets/key'))).toBeUndefined()
    expect(read(join(home, '.aws/credentials'))).toBe('deny')
    // A carve-out from the same file.
    expect(read(join(project, 'certs/server.pem'))).toBe('deny')
    expect(read(join(project, 'certs/sample.pem'))).toBeUndefined()
    // A Read denial guards writes too; `//` is the filesystem root.
    expect(
      decide({
        toolName: 'write',
        paths: [join(project, '.env')],
        writes: [join(project, '.env')],
      }),
    ).toBe('deny')
    expect(decide({ toolName: 'edit', paths: ['/etc/hosts'], writes: ['/etc/hosts'] })).toBe('deny')
    // A shell line that names the file.
    expect(decide({ ...bash('cat .env'), paths: [join(project, '.env')] })).toBe('deny')
    // An allow single-directory pattern stays at the working directory.
    const edit = (path: string) => decide({ toolName: 'edit', paths: [path], writes: [path] })
    expect(edit(join(project, 'src/app.ts'))).toBe('allow')
    expect(edit(join(project, 'vendor/src/lib.js'))).toBeUndefined()
  })

  test("a committed project file's allow rules wait for the folder to be trusted", async () => {
    const tree = {
      'project/.claude/settings.json': settings({ allow: ['Bash'], deny: ['Bash(rm *)'] }),
      'project/.claude/settings.local.json': settings({ allow: ['Bash(ls *)'] }),
    }
    const untrusted = await rulesFor(tree, { projectTrusted: false })
    expect(untrusted.decide(bash('make'))).toBeUndefined()
    expect(untrusted.decide(bash('ls -la'))).toBe('allow')
    expect(untrusted.decide(bash('rm x'))).toBe('deny')
    const trusted = await rulesFor(tree, { projectTrusted: true })
    expect(trusted.decide(bash('make'))).toBe('allow')
  })

  test('allowManagedPermissionRulesOnly leaves only the managed rules', async () => {
    const { decide } = await rulesFor({
      'home/.claude/settings.json': settings({ allow: ['Bash'] }),
      'managed/managed-settings.json': settings(
        { ask: ['Bash(git push *)'] },
        { allowManagedPermissionRulesOnly: true },
      ),
    })
    expect(decide(bash('make'))).toBeUndefined()
    expect(decide(bash('git push'))).toBe('ask')
  })

  test('MCP and web rules', async () => {
    const { rules, decide } = await rulesFor({
      'home/.claude/settings.json': settings({
        deny: ['mcp__github', 'WebFetch(domain:*.evil.example)'],
        allow: ['mcp__linear__*', 'WebFetch(domain:docs.example.com)'],
      }),
    })
    const gh = { name: 'mcp_github_create_issue', aliases: ['mcp__github__create_issue'] }
    expect(settingsRemoveTool(rules, gh)).toBe(true)
    expect(settingsRemoveTool(rules, { name: 'research' })).toBe(false)
    expect(decide({ toolName: 'mcp_linear_list', aliases: ['mcp__linear__list'] })).toBe('allow')
    const fetch = (url: string) => decide({ toolName: 'research', input: { urls: [url] } })
    expect(fetch('https://a.b.evil.example/x')).toBe('deny')
    expect(fetch('https://docs.example.com/page')).toBe('allow')
    expect(fetch('https://example.com/')).toBeUndefined()
  })
})
