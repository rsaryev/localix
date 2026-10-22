import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { scanDirs } from './discovery-directory-scan'
import { listCommandsFromCatalog } from './commands'
import type { PluginCatalog } from './catalog'

/** A plugin's `workflows/*.js` run as its commands, `/<plugin>:<meta.name>`, as in Claude Code. */
let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'workflow-commands-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function write(rel: string, content: string): Promise<void> {
  const file = join(root, rel)
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

describe('workflow commands', () => {
  test('each workflow is a command that runs it with the workflow tool', async () => {
    await write('acme/.claude-plugin/plugin.json', JSON.stringify({ name: 'acme' }))
    await write('acme/commands/ship.md', '---\ndescription: Ship\n---\n\nShip it.\n')
    await write(
      'acme/workflows/audit.js',
      "export const meta = { name: 'release-audit', description: 'Audit the release' }\nreturn 1\n",
    )
    const [plugin] = await scanDirs(root, [''], 'global', '')
    const command = plugin!.commands.find((entry) => entry.name === 'release-audit')
    expect(command).toMatchObject({
      description: 'Audit the release',
      activateTools: ['workflow'],
      argumentHint: '[input]',
    })
    expect(command!.prompt).toContain('`acme:release-audit` now with the `workflow` tool')
    expect(command!.prompt).toContain('$ARGUMENTS')
    // A "+500k" in the input is the run's token target, as Claude Code reads it.
    expect(command!.prompt).toContain('pass it as budget')
    expect(plugin!.provides.commands).toEqual(['ship', 'release-audit'])

    const catalog = { enabled: [{ plugin }] } as unknown as PluginCatalog
    expect(listCommandsFromCatalog(catalog, '').map((entry) => entry.fullName)).toEqual([
      'acme:ship',
      'acme:release-audit',
    ])
  })

  test('a command of the same name keeps its place', async () => {
    await write('acme/.claude-plugin/plugin.json', JSON.stringify({ name: 'acme' }))
    await write('acme/commands/audit.md', 'The command.\n')
    await write(
      'acme/workflows/audit.js',
      "export const meta = { name: 'audit', description: 'The workflow' }\n",
    )
    const [plugin] = await scanDirs(root, [''], 'global', '')
    expect(plugin!.commands.map((entry) => [entry.name, entry.prompt])).toEqual([
      ['audit', 'The command.'],
    ])
  })
})
