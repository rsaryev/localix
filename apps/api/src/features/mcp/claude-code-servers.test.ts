import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { claudeCodeMcpServers } from './claude-code-servers'
import type { McpServerRecord } from './repository'
import { withClaudeCodeMcp } from './testing/claude-code-host'

withClaudeCodeMcp()

/**
 * The MCP servers a person configured for Claude Code join a Localix run in that folder, as
 * Claude Code loads them (mcp.md, "MCP installation scopes", "Project server approvals"; and
 * managed-mcp.md): user and local servers from `~/.claude.json`, a project's `.mcp.json` once
 * approved, the organization's managed servers, and its allow and deny lists over every server.
 */
const scratch = tempDirPerTest('cc-mcp-servers-')

const own = (name: string, config: Record<string, unknown>): McpServerRecord => ({
  id: `own-${name}`,
  userId: 'u',
  projectId: 'P1',
  name,
  description: '',
  transport: config.url ? 'http' : 'stdio',
  config,
  createdAt: '',
  updatedAt: '',
})

let case_ = 0
function serversFor(
  treeOf: Record<string, string> | ((project: string) => Record<string, string>),
  input: {
    own?: McpServerRecord[]
    plugins?: McpServerRecord[]
    extra?: McpServerRecord[]
    /** The folder's own trust, or `'parent'`: the folder above it trusted. */
    trusted?: boolean | 'parent'
  } = {},
) {
  const root = join(scratch(), `case-${case_++}`)
  const project = join(root, 'project')
  const tree = typeof treeOf === 'function' ? treeOf(project) : treeOf
  const state = JSON.parse(tree['home/.claude.json'] ?? '{}') as Record<string, unknown>
  if (input.trusted) {
    const projects = (state.projects ?? {}) as Record<string, Record<string, unknown>>
    const key = input.trusted === 'parent' ? root : project
    projects[key] = { ...projects[key], hasTrustDialogAccepted: true }
    state.projects = projects
  }
  writeTree(root, { ...tree, 'home/.claude.json': JSON.stringify(state), 'project/.keep': '' })
  const result = claudeCodeMcpServers({
    own: input.own ?? [],
    plugins: input.plugins ?? [],
    ...(input.extra ? { extra: input.extra } : {}),
    userId: 'u',
    projectId: 'P1',
    cwd: project,
    homeDir: join(root, 'home'),
    env: {},
    managed: { dir: join(root, 'managed') },
  })
  return { project, names: result.map((s) => s.name), servers: result }
}

describe("Claude Code's MCP servers in a Localix run", () => {
  test('user and local servers load; local wins a name; Localix’s own wins over both', () => {
    const { names, servers } = serversFor(
      (project) => ({
        'home/.claude.json': JSON.stringify({
          mcpServers: {
            docs: { type: 'http', url: 'https://user.example/mcp' },
            shared: { command: 'user-shared' },
          },
          projects: {
            [project]: {
              mcpServers: { docs: { type: 'http', url: 'https://local.example/mcp' } },
            },
          },
        }),
      }),
      { own: [own('shared', { command: ['mine'] })] },
    )
    expect(names.sort()).toEqual(['docs', 'shared'])
    expect(servers.find((s) => s.name === 'docs')?.config.url).toBe('https://local.example/mcp')
    expect(servers.find((s) => s.name === 'shared')?.id).toBe('own-shared')
  })

  test("a project's .mcp.json server loads only once approved", () => {
    const mcpJson = JSON.stringify({
      mcpServers: { db: { command: 'db-mcp', args: ['--ro'] }, other: { command: 'x' } },
    })
    expect(serversFor({ 'project/.mcp.json': mcpJson }).names).toEqual([])
    expect(
      serversFor({
        'project/.mcp.json': mcpJson,
        'home/.claude/settings.json': JSON.stringify({ enabledMcpjsonServers: ['db'] }),
      }).names,
    ).toEqual(['db'])
    // The repository cannot approve its own servers until the folder is trusted.
    const selfApproved = {
      'project/.mcp.json': mcpJson,
      'project/.claude/settings.json': JSON.stringify({ enableAllProjectMcpServers: true }),
    }
    expect(serversFor(selfApproved).names).toEqual([])
    expect(serversFor(selfApproved, { trusted: true }).names.sort()).toEqual(['db', 'other'])
    // A parent folder's trust is not the folder's: its own approvals still do not count.
    expect(serversFor(selfApproved, { trusted: 'parent' }).names).toEqual([])
    // A rejection in any file holds.
    expect(
      serversFor(
        {
          ...selfApproved,
          'home/.claude/settings.json': JSON.stringify({ disabledMcpjsonServers: ['other'] }),
        },
        { trusted: true },
      ).names,
    ).toEqual(['db'])
    const db = serversFor({
      'project/.mcp.json': mcpJson,
      'home/.claude/settings.json': JSON.stringify({ enabledMcpjsonServers: ['db'] }),
    }).servers[0]
    expect(db?.config.command).toEqual(['db-mcp', '--ro'])
  })

  test('managed-mcp.json takes exclusive control; managedMcpServers adds to the rest', () => {
    const exclusive = serversFor(
      {
        'managed/managed-mcp.json': JSON.stringify({
          mcpServers: { corp: { type: 'http', url: 'https://corp.example/mcp' } },
        }),
        'home/.claude.json': JSON.stringify({ mcpServers: { mine: { command: 'm' } } }),
      },
      { own: [own('own', { command: ['o'] })], plugins: [own('p_srv', { command: ['p'] })] },
    )
    expect(exclusive.names).toEqual(['corp'])
    const provided = serversFor(
      {
        'managed/managed-settings.json': JSON.stringify({
          managedMcpServers: { search: { type: 'http', url: 'https://search.example/mcp' } },
        }),
        'home/.claude.json': JSON.stringify({ mcpServers: { search: { command: 'mine' } } }),
      },
      { own: [own('own', { command: ['o'] })] },
    )
    expect(provided.names.sort()).toEqual(['own', 'search'])
    expect(provided.servers.find((s) => s.name === 'search')?.transport).toBe('http')
  })

  test('the deny list blocks any server; an allow list keeps only what it names', () => {
    const tree = {
      'home/.claude.json': JSON.stringify({
        mcpServers: {
          remote: { type: 'http', url: 'https://mcp.example.com/api' },
          tool: { command: 'npx', args: ['-y', 'server'] },
        },
      }),
    }
    const denied = serversFor(
      {
        ...tree,
        'home/.claude/settings.json': JSON.stringify({
          deniedMcpServers: [{ serverUrl: 'https://mcp.example.com/*' }],
        }),
      },
      { own: [own('mine', { url: 'https://mcp.example.com/x' })] },
    )
    expect(denied.names).toEqual(['tool'])
    const allowed = serversFor({
      ...tree,
      'managed/managed-settings.json': JSON.stringify({
        allowedMcpServers: [{ serverCommand: ['npx', '-y', 'server'] }],
      }),
    })
    expect(allowed.names).toEqual(['tool'])
  })

  test('allowManagedMcpServersOnly reads the allow list of the managed settings alone', () => {
    const { names } = serversFor({
      'home/.claude.json': JSON.stringify({
        mcpServers: {
          remote: { type: 'http', url: 'https://mcp.example.com/api' },
          tool: { command: 'npx', args: ['-y', 'server'] },
        },
      }),
      'home/.claude/settings.json': JSON.stringify({ allowedMcpServers: [{ serverName: 'tool' }] }),
      'managed/managed-settings.json': JSON.stringify({
        allowManagedMcpServersOnly: true,
        allowedMcpServers: [{ serverName: 'remote' }],
      }),
    })
    expect(names).toEqual(['remote'])
  })

  // Kit wins: Claude Code's `/mcp` toggles (`projects["<folder>"].disabledMcpServers`) apply.
  test('a server turned off in /mcp for the folder does not load', () => {
    const { names } = serversFor((project) => ({
      'home/.claude.json': JSON.stringify({
        mcpServers: { docs: { command: 'docs' }, other: { command: 'other' } },
        projects: { [project]: { disabledMcpServers: ['docs'] } },
      }),
    }))
    expect(names).toEqual(['other'])
  })

  // mcp.md, "Scope hierarchy and precedence": plugins are matched by endpoint, not by name.
  test("a plugin's server at a configured server's endpoint is the configured one", () => {
    const url = 'https://mcp.example.com/api'
    const { names } = serversFor(
      { 'home/.claude.json': JSON.stringify({ mcpServers: { docs: { type: 'http', url } } }) },
      { plugins: [own('p_same', { url }), own('p_other', { url: 'https://other.example/mcp' })] },
    )
    expect(names.sort()).toEqual(['docs', 'p_other'])
  })

  /**
   * A `headersHelper` is an arbitrary shell command. Claude Code runs the helper of a project
   * `.mcp.json` or local-scope server only once the person trusted the folder itself, and connects
   * with the static headers alone until then (mcp.md, "Trust a folder before its headersHelper
   * runs"). Each Claude Code file's server carries the trust of the folder it was read in, for the
   * kit's gate where it connects (`kit/settings/mcp-remote.ts`); an entry cannot write its own.
   */
  test('each server carries the trust of the folder it was read in, over any it claims', () => {
    const remote = {
      type: 'http',
      url: 'https://mcp.example.com/mcp',
      headers: { 'X-Static': 's' },
      headersHelper: './auth.sh',
      headersHelperTrust: { source: 'persisted', key: '/elsewhere' },
    }
    const approvedProject = (project: string) => ({
      'project/.mcp.json': JSON.stringify({ mcpServers: { api: remote } }),
      'home/.claude/settings.json': JSON.stringify({ enabledMcpjsonServers: ['api'] }),
      [`home/.claude.json`]: JSON.stringify({
        mcpServers: { mine: remote },
        projects: { [project]: { mcpServers: { here: remote } } },
      }),
    })
    const stamps = (trusted?: boolean | 'parent') => {
      const found = serversFor(approvedProject, trusted === undefined ? {} : { trusted })
      return {
        project: found.project,
        stamp: Object.fromEntries(found.servers.map((s) => [s.name, s.config.headersHelperTrust])),
        helper: found.servers.map((s) => s.config.headersHelper),
      }
    }
    for (const [trusted, source] of [
      [undefined, 'none'],
      ['parent', 'parent-folder'],
      [true, 'persisted'],
    ] as const) {
      const { project, stamp, helper } = stamps(trusted)
      const expected = { source, key: project }
      expect(stamp).toEqual({ api: expected, here: expected, mine: expected })
      expect(helper).toEqual(['./auth.sh', './auth.sh', './auth.sh'])
    }
  })

  test('a project server nobody approved is not connected at all, so its helper never runs', () => {
    const mcpJson = JSON.stringify({
      mcpServers: {
        api: { type: 'http', url: 'https://mcp.example.com/mcp', headersHelper: 'touch /tmp/x' },
      },
    })
    expect(serversFor({ 'project/.mcp.json': mcpJson }, { trusted: true }).names).toEqual([])
  })

  // mcp.md, "Option 2": a `url` with no `type` reads as stdio and is skipped; a `${VAR}` stays for
  // the connection to expand, so it is expanded once.
  test('an entry Claude Code skips does not load; a reference is left for the connection', () => {
    const { names, servers } = serversFor({
      'home/.claude.json': JSON.stringify({
        mcpServers: {
          untyped: { url: 'https://mcp.example.com/mcp' },
          listed: { command: ['python', 'server.py'] },
          tool: { command: 'npx', args: ['${TOOL_PKG}'] },
        },
      }),
    })
    expect(names).toEqual(['tool'])
    expect(servers[0]?.config.command).toEqual(['npx', '${TOOL_PKG}'])
  })

  test("an agent's inline servers join the run under the organization's deny list", () => {
    const inline = [
      own('mine', { command: ['mine-server'] }),
      own('blocked', { url: 'https://mcp.example.com/x' }),
    ]
    const { names } = serversFor(
      {
        'home/.claude/settings.json': JSON.stringify({
          deniedMcpServers: [{ serverUrl: 'https://mcp.example.com/*' }],
        }),
      },
      { own: [own('configured', { command: ['c'] })], extra: inline },
    )
    expect(names).toEqual(['configured', 'mine'])
  })

  test('a configured server keeps its name against an inline one', () => {
    const { servers } = serversFor(
      {},
      {
        own: [own('github', { command: ['configured'] })],
        extra: [own('github', { command: ['inline'] })],
      },
    )
    expect(servers.map((s) => s.config.command)).toEqual([['configured']])
  })
})
