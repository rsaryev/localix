import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { folderRepository } from './repository'

let dirs: string[] = []
const temp = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kit-repo-')))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('folderRepository', () => {
  test('the nearest folder holding .git, owned by the user', () => {
    const root = temp()
    mkdirSync(join(root, '.git'))
    mkdirSync(join(root, 'src', 'deep'), { recursive: true })
    expect(folderRepository(join(root, 'src', 'deep'))).toEqual({
      checkout: root,
      root,
      ownedByUser: true,
    })
  })

  test('a linked checkout resolves to its main one', () => {
    const main = temp()
    const linked = temp()
    mkdirSync(join(main, '.git', 'worktrees', 'side'), { recursive: true })
    writeFileSync(join(linked, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'side')}\n`)
    expect(folderRepository(linked)).toMatchObject({ checkout: linked, root: main })
  })

  test('undefined outside a repository', () => {
    expect(folderRepository(temp())).toBeUndefined()
  })
})
