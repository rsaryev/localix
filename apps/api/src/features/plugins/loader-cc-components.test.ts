import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import { MANIFEST_FILE } from '@localixai/claude-plugin'
import { tempDirPerTest } from '@localixai/testing'

import { loadManifest } from './discovery'
import { emptyLoadedPlugins } from './loader-contract'
import { appendPluginRuntimeDeclarations } from './loader-runtime-declarations'
import { activeOutputStyle, findOutputStyle } from './output-styles'

const dir = tempDirPerTest('cc-components-')

async function write(rel: string, content: string | object): Promise<void> {
  const file = join(dir(), rel)
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, typeof content === 'string' ? content : JSON.stringify(content))
}

async function load() {
  const plugin = await loadManifest(dir(), 'global', '')
  const result = emptyLoadedPlugins()
  appendPluginRuntimeDeclarations({
    plugin,
    config: {},
    subst: (text) => text.replaceAll('${CLAUDE_PLUGIN_ROOT}', '/root'),
    result,
    summary: {
      name: 'sec',
      scope: 'global',
      description: '',
      skills: [],
      mcpServers: [],
    },
    opts: { homeDir: dir() },
  })
  return result
}

describe('an enabled plugin’s output styles and default agent', () => {
  test('reach the run: styles as `<plugin>:<name>`, `settings.agent` as the main agent', async () => {
    await write(MANIFEST_FILE, { name: 'sec' })
    await write(
      'output-styles/terse.md',
      '---\ndescription: Short\n---\n\nShort replies. Notes in ${CLAUDE_PLUGIN_ROOT}/notes.\n',
    )
    await write(
      'agents/security-reviewer.md',
      '---\nname: security-reviewer\ndescription: Reviews\ntools: Read, Grep\n---\n\nYou review.\n',
    )
    await write('settings.json', { agent: 'security-reviewer' })
    const result = await load()
    expect(result.outputStyles).toEqual([
      expect.objectContaining({
        pluginName: 'sec',
        fullName: 'sec:terse',
        style: expect.objectContaining({ prompt: 'Short replies. Notes in /root/notes.' }),
      }),
    ])
    expect(result.mainAgent).toMatchObject({
      fullName: 'sec:security-reviewer',
      prompt: 'You review.',
      tools: ['Read', 'Search'],
    })
  })

  test('a setting that names no agent of the plugin applies nothing', async () => {
    await write(MANIFEST_FILE, { name: 'sec', settings: { agent: 'missing' } })
    expect((await load()).mainAgent).toBeNull()
  })
})

describe('choosing a style', () => {
  const entry = (plugin: string, name: string, forceForPlugin = false) => ({
    pluginName: plugin,
    fullName: `${plugin}:${name}`,
    source: 'plugin' as const,
    style: { name, description: '', keepCodingInstructions: false, forceForPlugin, prompt: name },
  })

  test('a forced style wins; a chosen style counts only while it is offered', () => {
    const styles = [entry('a', 'terse'), entry('b', 'house', true)]
    expect(activeOutputStyle(styles, 'a:terse')?.fullName).toBe('b:house')
    expect(activeOutputStyle([entry('a', 'terse')], 'a:terse')?.fullName).toBe('a:terse')
    expect(activeOutputStyle([entry('a', 'terse')], 'gone:style')).toBeNull()
    expect(activeOutputStyle([entry('a', 'terse')], null)).toBeNull()
  })

  test('a query names the default, a full name, or a bare name one plugin offers', () => {
    const styles = [entry('a', 'terse'), entry('b', 'terse'), entry('a', 'teacher')]
    expect(findOutputStyle(styles, 'Default')).toEqual({ kind: 'default' })
    expect(findOutputStyle(styles, 'B:Terse')).toMatchObject({ entry: { fullName: 'b:terse' } })
    expect(findOutputStyle(styles, 'teacher')).toMatchObject({ entry: { fullName: 'a:teacher' } })
    expect(findOutputStyle(styles, 'terse')).toEqual({ kind: 'ambiguous' })
    expect(findOutputStyle(styles, 'loud')).toEqual({ kind: 'none' })
  })
})
