import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import { PLUGIN_MANIFEST as MANIFEST_FILE } from './kit'
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
    subst: (text) => text.replaceAll('${CLAUDE_PLUGIN_ROOT}', '/root'),
    result,
  })
  return result
}

describe('an enabled plugin’s output styles', () => {
  test('reach the run as `<plugin>:<name>`, their text substituted', async () => {
    await write(MANIFEST_FILE, { name: 'sec' })
    await write(
      'output-styles/terse.md',
      '---\ndescription: Short\n---\n\nShort replies. Notes in ${CLAUDE_PLUGIN_ROOT}/notes.\n',
    )
    const result = await load()
    expect(result.outputStyles).toEqual([
      expect.objectContaining({
        pluginName: 'sec',
        fullName: 'sec:terse',
        style: expect.objectContaining({ instructions: 'Short replies. Notes in /root/notes.' }),
      }),
    ])
  })
})

describe('choosing a style', () => {
  const entry = (plugin: string, name: string, forceForPlugin = false) => ({
    pluginName: plugin,
    fullName: `${plugin}:${name}`,
    source: 'plugin' as const,
    style: {
      name,
      description: '',
      keepCodingInstructions: false,
      forceForPlugin,
      instructions: name,
    },
  })

  test('a forced style wins; a chosen style counts only while it is offered', () => {
    const styles = [entry('a', 'terse'), entry('b', 'house', true)]
    expect(activeOutputStyle(styles, 'a:terse')?.fullName).toBe('b:house')
    expect(activeOutputStyle([entry('a', 'terse')], 'a:terse')?.fullName).toBe('a:terse')
    expect(activeOutputStyle([entry('a', 'terse')], 'gone:style')).toBeNull()
    expect(activeOutputStyle([entry('a', 'terse')], null)).toBeNull()
  })

  // output-styles.md: `/output-style` wins over the setting, and `default` is a choice of its own.
  test('a choice nothing offers leaves the setting in force; `default` over the setting is none', () => {
    const styles = [entry('a', 'terse'), entry('a', 'house')]
    expect(activeOutputStyle(styles, 'gone:style', 'a:house')?.fullName).toBe('a:house')
    expect(activeOutputStyle(styles, 'default', 'a:house')).toBeNull()
    expect(activeOutputStyle(styles, null, 'a:house')?.fullName).toBe('a:house')
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
