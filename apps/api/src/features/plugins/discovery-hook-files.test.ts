import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import { MANIFEST_FILE } from '@localixai/claude-plugin'
import { tempDirPerTest } from '@localixai/testing'

import { loadManifest } from './discovery'
import { hooksFileProblem, readPluginHookFiles } from './discovery-hook-files'
import { emptyLoadedPlugins } from './loader-contract'
import { appendPluginRuntimeDeclarations } from './loader-runtime-declarations'

/**
 * A hooks file that cannot load used to contribute nothing in silence. Claude Code reports
 * `Failed to load hooks from <path>: <reason>` and `hooks path not found: <path>` and still loads
 * the plugin's other hooks (plugin troubleshooting, "Hooks fail to load").
 */
const dir = tempDirPerTest('hook-files-')
const stop = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'true' }] }] } }

async function write(rel: string, content: string | object): Promise<void> {
  const file = join(dir(), rel)
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, typeof content === 'string' ? content : JSON.stringify(content))
}

const read = (files: string[] = [], inline: Record<string, unknown>[] = []) =>
  readPluginHookFiles(dir(), 'hooks/hooks.json', { files, inline })

describe('plugin hooks files', () => {
  test('an invalid hooks.json is reported and the listed files still load', async () => {
    await write('hooks/hooks.json', '{ "hooks": ')
    await write('extra.json', stop)
    const result = await read(['./extra.json'])
    expect(result.configs).toEqual([stop])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toStartWith(
      `Failed to load hooks from ${join(dir(), 'hooks/hooks.json')}: `,
    )
  })

  test('a listed file that does not exist is "hooks path not found"', async () => {
    const result = await read(['./missing.json'])
    expect(result.errors).toEqual([`hooks path not found: ${join(dir(), 'missing.json')}`])
    expect(result.configs).toEqual([])
  })

  test('a listed path outside the plugin is refused', async () => {
    expect((await read(['../outside.json'])).errors).toEqual([
      'hooks path escapes plugin directory: ../outside.json',
    ])
  })

  test('a file with only the event map fails the hooks schema', async () => {
    await write('hooks/hooks.json', stop.hooks)
    const { errors, configs } = await read()
    expect(configs).toEqual([])
    expect(errors[0]).toContain('missing the top-level "hooks" key')
  })

  test('the schema names the offending field', () => {
    const handler = (extra: Record<string, unknown>) => ({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x', ...extra }] }] },
    })
    expect(hooksFileProblem(handler({ args: ['a', 1] }))).toBe(
      'hooks.Stop[0].hooks[0].args: expected an array of strings',
    )
    expect(hooksFileProblem(handler({ shell: 'zsh' }))).toContain('.shell')
    expect(hooksFileProblem({ hooks: { Stop: {} } })).toContain('hooks.Stop')
    expect(hooksFileProblem(handler({ args: ['a'] }))).toBeUndefined()
    // A mod's hooks file names its module and need not carry an event map.
    expect(hooksFileProblem({ description: 'mod', modules: ['./register.ts'] })).toBeUndefined()
  })

  test('the failure becomes the plugin’s load error and a validation error', async () => {
    await write(MANIFEST_FILE, { name: 'hooked' })
    await write('hooks/hooks.json', '{ not json')
    const plugin = await loadManifest(dir(), 'global', '')
    expect(plugin.error).toBeUndefined()
    const message = plugin.entrypoints.hookErrors?.[0] ?? ''
    expect(message).toStartWith('Failed to load hooks from ')
    expect(plugin.layoutIssues).toContainEqual({ severity: 'error', path: 'hooks', message })

    const result = emptyLoadedPlugins()
    const summary = {
      name: 'hooked',
      scope: 'global' as const,
      description: '',
      toolNames: [],
      skills: [],
      mcpServers: [],
    } as Parameters<typeof appendPluginRuntimeDeclarations>[0]['summary']
    const warnings: string[] = []
    appendPluginRuntimeDeclarations({
      plugin,
      config: {},
      subst: (text) => text,
      result,
      summary,
      opts: { homeDir: dir(), logger: { warn: (m) => warnings.push(m) } },
    })
    expect(summary.error).toBe(message)
    expect(warnings).toEqual([`plugin "hooked": ${message}`])
    expect(result.ccHooks).toEqual([])
  })
})
