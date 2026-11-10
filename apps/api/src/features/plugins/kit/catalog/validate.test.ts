import { describe, expect, test } from 'bun:test'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { validatePluginFolder } from './validate'

const dir = tempDirPerTest('kit-validate')

describe('a plugin folder validated by the kit', () => {
  test('a manifest field of the wrong shape is an error, a clean plugin has none', async () => {
    writeTree(dir(), { '.claude-plugin/plugin.json': JSON.stringify({ name: 'ok', version: 3 }) })
    const report = await validatePluginFolder(dir())
    expect(report.errors.some((message) => message.includes('version'))).toBe(true)
  })

  test('a clean plugin has no error', async () => {
    writeTree(dir(), {
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'ok', description: 'Fine' }),
    })
    expect((await validatePluginFolder(dir())).errors).toEqual([])
  })
})
