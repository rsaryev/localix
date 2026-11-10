import { describe, expect, test } from 'bun:test'
import { mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import type { PluginFiles } from '@rsaryev/llx-plugin'
import { memoryFiles } from '@rsaryev/llx-plugin/testing'
import { diskFiles } from './files'

const dir = tempDirPerTest('kit-files')

/** One folder, built twice: on the disk and as the kit's reference fake. */
function folder(): { disk: PluginFiles; memory: PluginFiles; root: string } {
  const root = dir()
  writeTree(root, {
    '.claude-plugin/plugin.json': '{"name":"demo"}',
    'skills/review/SKILL.md': '# Review',
    'bin/tool': new Uint8Array([1, 2, 3]),
  })
  mkdirSync(join(root, 'empty'))
  symlinkSync('skills/review', join(root, 'linked'))
  symlinkSync('../outside.md', join(root, 'leaves'))
  symlinkSync('missing.md', join(root, 'dangles'))
  const memory = memoryFiles({
    '.claude-plugin/plugin.json': '{"name":"demo"}',
    'skills/review/SKILL.md': '# Review',
    'bin/tool': new Uint8Array([1, 2, 3]),
    'empty/.keep': '',
    linked: { symlink: 'skills/review' },
    leaves: { symlink: '../outside.md' },
    dangles: { symlink: 'missing.md' },
  })
  return { disk: diskFiles(root), memory, root }
}

const names = async (files: PluginFiles, path: string) =>
  (await files.list(path))?.map((entry) => entry.name).toSorted()

describe('the disk folder answers as the kit reference fake does', () => {
  test('reads a file, its bytes and nothing outside the folder', async () => {
    const { disk, memory } = folder()
    for (const files of [disk, memory]) {
      expect(await files.readText('.claude-plugin/plugin.json')).toBe('{"name":"demo"}')
      expect(await files.readBytes('bin/tool')).toEqual(new Uint8Array([1, 2, 3]))
      expect(await files.readText('linked/SKILL.md')).toBe('# Review')
      expect(await files.readText('missing.md')).toBeUndefined()
      expect(await files.readText('leaves')).toBeUndefined()
      expect(await files.readText('skills')).toBeUndefined()
      expect(await files.readText('../outside.md')).toBeUndefined()
    }
  })

  test('lists a folder, follows a link inside it, and has no listing for a file', async () => {
    const { disk, memory } = folder()
    for (const files of [disk, memory]) {
      expect(await names(files, 'skills')).toEqual(['review'])
      expect(await names(files, 'linked')).toEqual(['SKILL.md'])
      expect(await files.list('bin/tool')).toBeUndefined()
      expect(await files.list('nowhere')).toBeUndefined()
      const linked = (await files.list('.'))?.find((entry) => entry.name === 'linked')
      expect(linked).toEqual({ name: 'linked', isFile: false, isDirectory: true })
    }
  })

  test('stats a link with where it points, inside or out, dangling or not', async () => {
    const { disk, memory } = folder()
    for (const files of [disk, memory]) {
      expect(await files.stat('linked')).toEqual({
        isFile: false,
        isDirectory: true,
        isSymlink: true,
        size: 0,
        realPath: 'skills/review',
      })
      expect(await files.stat('skills/review/SKILL.md')).toMatchObject({ isFile: true, size: 8 })
      expect(await files.stat('leaves')).toMatchObject({ isSymlink: true, isFile: false })
      expect(await files.stat('dangles')).toMatchObject({ isSymlink: true, isFile: false })
      expect(await files.exists('dangles')).toBe(true)
      expect(await files.exists('nowhere')).toBe(false)
    }
  })

  test('names a link that leaves the folder by its absolute host path', async () => {
    const { disk, root } = folder()
    const realPath = (await disk.stat('leaves'))?.realPath ?? ''
    expect(realPath.endsWith(`${root.split('/').slice(0, -1).pop()}/outside.md`)).toBe(true)
  })

  test('gives the host path of a path below the folder', () => {
    const { root } = folder()
    expect(diskFiles(root).hostPath('skills/review')).toBe(join(root, 'skills/review'))
    expect(diskFiles(root).hostPath('.')).toBe(root)
  })
})
