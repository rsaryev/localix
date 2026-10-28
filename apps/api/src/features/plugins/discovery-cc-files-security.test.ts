import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MAX_SKILL_MARKDOWN_BYTES } from '../agent-core/skill-file'
import { collectMarkdownFiles, parseAgentFile, parseCommandFile } from './discovery-cc-files'
import { buildLoadedAgent } from './loader-contract'
import type { PluginArtifactDiagnostic } from './discovery-entrypoints'

describe('bounded plugin command/agent markdown discovery', () => {
  test('rejects oversized command and agent files with diagnostics', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'plugin-md-large-'))
    try {
      const command = join(root, 'large-command.md')
      const agent = join(root, 'large-agent.md')
      const oversized = 'x'.repeat(MAX_SKILL_MARKDOWN_BYTES + 1)
      await Promise.all([fs.writeFile(command, oversized), fs.writeFile(agent, oversized)])
      const diagnostics: PluginArtifactDiagnostic[] = []

      expect(await parseCommandFile(command, undefined, diagnostics)).toBeNull()
      expect(await parseAgentFile(agent, undefined, diagnostics)).toBeNull()
      expect(diagnostics).toHaveLength(2)
      expect(diagnostics.every((diagnostic) => diagnostic.message.includes('file is'))).toBe(true)
      expect(
        diagnostics.every((diagnostic) =>
          diagnostic.message.includes(`limit ${MAX_SKILL_MARKDOWN_BYTES} bytes`),
        ),
      ).toBe(true)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test('blocks explicit file and default-directory symlink escapes from a plugin', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'plugin-md-root-'))
    const outside = await fs.mkdtemp(join(tmpdir(), 'plugin-md-outside-'))
    try {
      const externalFile = join(outside, 'external.md')
      await fs.writeFile(externalFile, '---\ndescription: outside\n---\nDo not load.')
      await fs.symlink(externalFile, join(root, 'escaped.md'), 'file')
      await fs.symlink(outside, join(root, 'commands'), 'dir')
      const diagnostics: PluginArtifactDiagnostic[] = []

      const files = await collectMarkdownFiles(root, ['./escaped.md'], 'commands', {
        diagnostics,
        kind: 'command',
      })

      expect(files).toEqual([])
      expect(diagnostics.filter((item) => item.message.includes('symlink escape'))).toHaveLength(2)
    } finally {
      await Promise.all([
        fs.rm(root, { recursive: true, force: true }),
        fs.rm(outside, { recursive: true, force: true }),
      ])
    }
  })

  test('unsafe replacement paths do not hide the default commands', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'plugin-md-fallback-'))
    try {
      await fs.mkdir(join(root, 'commands'))
      const command = join(root, 'commands', 'default.md')
      await fs.writeFile(command, 'Default prompt.')

      const files = await collectMarkdownFiles(root, ['../outside', '/outside'], 'commands', {
        replaceDefault: true,
      })

      expect(files).toEqual([{ file: await fs.realpath(command), name: 'default' }])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test('the first explicit source wins a name collision before default discovery', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'plugin-md-precedence-'))
    try {
      for (const dir of ['first', 'second', 'commands']) {
        await fs.mkdir(join(root, dir))
        await fs.writeFile(join(root, dir, 'deploy.md'), `${dir} prompt.`)
      }
      const unique = join(root, 'commands', 'audit.md')
      await fs.writeFile(unique, 'Audit prompt.')

      const files = await collectMarkdownFiles(root, ['./first', './second'], 'commands')

      expect(files).toEqual([
        { file: await fs.realpath(unique), name: 'audit' },
        { file: await fs.realpath(join(root, 'first', 'deploy.md')), name: 'deploy' },
      ])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

describe('agent tools lists', () => {
  test.each([
    ['Agent(worker, researcher), Read', ['Agent', 'Read'], ['worker', 'researcher']],
    ['[Task(worker), Read]', ['Agent', 'Read'], ['worker']],
    ['Agent, Read', ['Agent', 'Read'], undefined],
    ['Read', ['Read'], undefined],
  ])('tools: %s names the types it may delegate to', async (tools, mapped, types) => {
    const root = await fs.mkdtemp(join(tmpdir(), 'plugin-agent-types-'))
    try {
      const agent = join(root, 'lead.md')
      await fs.writeFile(agent, `---\nname: lead\ndescription: d\ntools: ${tools}\n---\nLead.\n`)
      const parsed = await parseAgentFile(agent)
      expect(parsed?.tools).toEqual(mapped)
      expect(parsed?.agentTypes).toEqual(types)
      expect(buildLoadedAgent('p', parsed!, (text) => text).agentTypes).toEqual(types)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test('a disallowedTools entry with a specifier removes the whole tool, as in Claude Code', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'plugin-agent-deny-'))
    try {
      const agent = join(root, 'safe.md')
      await fs.writeFile(
        agent,
        '---\nname: safe\ndescription: d\ndisallowedTools: Bash(rm *), Write\n---\nBe safe.\n',
      )
      const parsed = await parseAgentFile(agent)
      expect(parsed?.disallowedTools).toEqual(['Bash', 'Write'])
      expect(buildLoadedAgent('p', parsed!, (text) => text).disallowedTools).toEqual([
        'Bash',
        'Write',
      ])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test('a tools list of only unmapped names stays an empty allowlist, not the inherited surface', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'plugin-agent-tools-'))
    try {
      const agent = join(root, 'planner.md')
      await fs.writeFile(
        agent,
        '---\nname: planner\ndescription: plans\ntools: TodoWrite, EnterPlanMode\ndisallowedTools: TodoWrite\n---\nPlan.\n',
      )
      const parsed = await parseAgentFile(agent)
      expect(parsed?.tools).toEqual([])
      expect(parsed?.disallowedTools).toBeUndefined()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
