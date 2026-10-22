import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { createFsApi } from './fs-api'

const scratch = tempDirPerTest('mods-fs', {})

test('ancestors finds memory files between the project root and a file, outermost first', async () => {
  const root = scratch()
  writeTree(root, {
    'CLAUDE.md': 'root rules',
    'pkg/AGENTS.md': 'package rules',
    'pkg/src/CLAUDE.md': 'source rules',
    'pkg/src/main.ts': '',
  })
  const fs = createFsApi(() => root)
  const found = await fs.ancestors({
    names: ['CLAUDE.md', 'AGENTS.md'],
    of: 'pkg/src/main.ts',
    below: root,
  })
  // Only directories strictly inside `below` are read, so the root's own file is not.
  expect(found.map(({ dir, name, content }) => [dir, name, content])).toEqual([
    [join(root, 'pkg'), 'AGENTS.md', 'package rules'],
    [join(root, 'pkg/src'), 'CLAUDE.md', 'source rules'],
  ])
  expect(found[0]!.parts).toEqual([{ path: join(root, 'pkg/AGENTS.md'), content: 'package rules' }])
  expect(
    await fs.ancestors({ names: ['CLAUDE.md'], of: '/elsewhere/file.ts', below: root }),
  ).toEqual([])
})

test('read gives text, or bytes as base64 as Claude Code does', async () => {
  const root = scratch()
  writeTree(root, { 'a.txt': 'hi' })
  const fs = createFsApi(() => root)
  expect(await fs.read('a.txt')).toBe('hi')
  expect(await fs.read('a.txt', { as: 'bytes' })).toEqual({ base64: 'aGk=' })
})
