import { describe, expect, test } from 'bun:test'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { tools } from './kit-tools'

const tempDir = tempDirPerTest('mini-app-kit-tools-')

const VALID = {
  name: 'gpu-monitor',
  version: '0.1.0',
  description: 'Watch the GPU.',
  apiVersion: 1,
  backend: './backend/index.ts',
}

describe('the kit’s manifest verdict', () => {
  test('a folder Localix would run has no errors', async () => {
    const dir = tempDir()
    writeTree(dir, { 'mini-app.json': JSON.stringify(VALID), 'guide.md': '# Guide' })
    expect(await tools.manifest.validate(dir)).toEqual({
      name: 'gpu-monitor',
      errors: [],
      warnings: [],
    })
  })

  test('says what Localix’s discovery would refuse, in its words', async () => {
    const dir = tempDir()
    writeTree(dir, { 'mini-app.json': JSON.stringify({ ...VALID, skills: './skills' }) })
    const verdict = await tools.manifest.validate(dir)
    expect(verdict.errors).toHaveLength(1)
    expect(verdict.errors[0]).toStartWith('Invalid mini-app.json:')
  })

  test('a plugin folder is not a mini app', async () => {
    const dir = tempDir()
    writeTree(dir, {
      'mini-app.json': JSON.stringify(VALID),
      '.claude-plugin/plugin.json': '{"name":"x"}',
    })
    expect((await tools.manifest.validate(dir)).errors.join('\n')).toContain('not both')
  })

  test('the host’s own checks speak too: duplicate views, a missing guide', async () => {
    const dir = tempDir()
    const view = { id: 'main', title: 'Main', file: './views/main.html' }
    writeTree(dir, { 'mini-app.json': JSON.stringify({ ...VALID, views: [view, view] }) })
    const verdict = await tools.manifest.validate(dir)
    expect(verdict.errors.join('\n')).toContain('Duplicate view "main"')
    expect(verdict.warnings.join('\n')).toContain('No guide.md')
  })

  test('an app built for a newer Localix is refused', async () => {
    const dir = tempDir()
    writeTree(dir, { 'mini-app.json': JSON.stringify({ ...VALID, apiVersion: 999 }) })
    expect((await tools.manifest.validate(dir)).errors.join('\n')).toContain('999')
  })
})

test('the tailwind compiler builds utilities against the stylesheet it is given', async () => {
  const compiler = await tools.compileTailwind(
    '@theme { --color-brand: #f00; } @tailwind utilities;',
    {
      base: '/',
      loadStylesheet: async () => {
        throw new Error('no imports here')
      },
      loadModule: async () => {
        throw new Error('no modules here')
      },
    },
  )
  expect(compiler.build(['text-brand'])).toContain('.text-brand')
})
