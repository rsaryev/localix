import { describe, expect, test } from 'bun:test'
import { mkdirSync, realpathSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { diskFolderScan } from './folder-scan'

const dir = tempDirPerTest('kit-folder-scan')
/** The temp dir with its links followed (macOS puts it under a `/private` link). */
const root = () => realpathSync(dir())

describe('the scope folders on the disk', () => {
  test('opens an existing folder for reading and has none for a missing one', async () => {
    writeTree(root(), { 'home/.claude/skills/a/SKILL.md': '# A' })
    const scan = diskFolderScan({ managedDirectory: undefined })
    const folder = await scan.open(join(root(), 'home'))
    expect(await folder?.files.readText('.claude/skills/a/SKILL.md')).toBe('# A')
    expect(folder?.hostPath('.claude/skills')).toBe(join(root(), 'home/.claude/skills'))
    expect(await scan.open(join(root(), 'nowhere'))).toBeUndefined()
    writeTree(root(), { 'file.txt': 'x' })
    expect(await scan.open(join(root(), 'file.txt'))).toBeUndefined()
  })

  test('follows a link wherever it leads, as a person links skills from elsewhere', async () => {
    writeTree(root(), { 'dotfiles/review/SKILL.md': '# Review', 'home/.claude/skills/.keep': '' })
    symlinkSync(join(root(), 'dotfiles/review'), join(root(), 'home/.claude/skills/review'))
    const folder = await diskFolderScan({ managedDirectory: undefined }).open(join(root(), 'home'))
    expect(await folder?.files.readText('.claude/skills/review/SKILL.md')).toBe('# Review')
    const names = (await folder?.files.list('.claude/skills'))?.map((entry) => entry.name)
    expect(names?.toSorted()).toEqual(['.keep', 'review'])
    expect(await folder?.files.stat('.claude/skills/review')).toMatchObject({
      isDirectory: true,
      isSymlink: true,
      realPath: join(root(), 'dotfiles/review'),
    })
  })

  test('names two paths of one target by the same canonical path', async () => {
    writeTree(root(), { 'shared/skills/a/SKILL.md': '# A' })
    symlinkSync(join(root(), 'shared'), join(root(), 'alias'))
    const folder = await diskFolderScan({ managedDirectory: undefined }).open(root())
    expect(await folder?.canonicalPath('alias/skills')).toBe(join(root(), 'shared/skills'))
    expect(await folder?.canonicalPath('missing')).toBeUndefined()
  })

  test('walks from the working directory up to the top of its repository', async () => {
    mkdirSync(join(root(), 'repo/.git'), { recursive: true })
    mkdirSync(join(root(), 'repo/apps/web'), { recursive: true })
    const chain = await diskFolderScan({ managedDirectory: undefined }).repository(
      join(root(), 'repo/apps/web'),
    )
    expect(chain).toEqual({
      directories: [join(root(), 'repo/apps/web'), join(root(), 'repo/apps'), join(root(), 'repo')],
    })
  })

  test('a linked worktree stops at its own top and names its main checkout', async () => {
    mkdirSync(join(root(), 'main/.git/worktrees/feature'), { recursive: true })
    writeTree(root(), {
      'feature/.git': `gitdir: ${join(root(), 'main/.git/worktrees/feature')}\n`,
      'feature/src/x.ts': '',
    })
    const chain = await diskFolderScan({ managedDirectory: undefined }).repository(
      join(root(), 'feature/src'),
    )
    expect(chain).toEqual({
      directories: [join(root(), 'feature/src'), join(root(), 'feature')],
      mainCheckout: join(root(), 'main'),
    })
  })

  test('a working directory outside a repository is alone', async () => {
    mkdirSync(join(root(), 'loose'))
    const chain = await diskFolderScan({ managedDirectory: undefined }).repository(
      join(root(), 'loose'),
    )
    expect(chain.directories[0]).toBe(join(root(), 'loose'))
    expect(chain.mainCheckout).toBeUndefined()
  })

  test('lists the folders between a start and a touched file, outermost first', async () => {
    const scan = diskFolderScan({ managedDirectory: '/managed' })
    expect(await scan.directoriesBelow('/repo', '/repo/apps/web/src/a.ts')).toEqual([
      '/repo/apps',
      '/repo/apps/web',
      '/repo/apps/web/src',
    ])
    expect(await scan.directoriesBelow('/repo', '/elsewhere/a.ts')).toEqual([])
    expect(scan.managedDirectory()).toBe('/managed')
  })
})
