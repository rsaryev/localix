import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MAX_SKILL_MARKDOWN_BYTES } from '../agent-core/skill-file'
import { collectMarkdownFiles, parseAgentFile, parseCommandFile } from './discovery-cc-files'
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
})
