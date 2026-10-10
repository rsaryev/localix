import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readCapped, resolveReference } from './course-bundle-files'

async function withCourseRoot(run: (root: string, parent: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'learning-bundle-files-'))
  try {
    const parent = await realpath(dir)
    const root = join(parent, 'course')
    await mkdir(root)
    await run(root, parent)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('references reject absolute and escaping paths before tracking a valid canonical file', async () => {
  await withCourseRoot(async (root, parent) => {
    const owner = join(root, 'course.json')
    const outside = join(parent, 'outside.md')
    const inside = join(root, 'inside.md')
    const tracked = new Set<string>()
    await writeFile(outside, 'Outside')
    await writeFile(inside, 'Inside')
    for (const reference of [outside, '../outside.md']) {
      await expect(resolveReference(owner, reference, root, tracked)).rejects.toMatchObject({
        diagnostic: { code: 'invalid-reference', file: owner },
      })
    }
    expect(tracked.size).toBe(0)
    expect(await resolveReference(owner, './inside.md', root, tracked)).toBe(inside)
    expect([...tracked]).toEqual([inside])
  })
})

test('capped reads count UTF-8 bytes and reject a directory reference', async () => {
  await withCourseRoot(async (root) => {
    const file = join(root, 'unicode.md')
    await writeFile(file, '😀😀')
    expect(await readCapped(file, 8)).toBe('😀😀')
    await expect(readCapped(file, 7)).rejects.toMatchObject({
      diagnostic: { code: 'invalid-content', file },
    })
    await expect(readCapped(root, 8)).rejects.toMatchObject({
      diagnostic: { code: 'invalid-reference', file: root },
    })
  })
})

// Windows requires elevated privileges or Developer Mode to create fixture symlinks.
test.skipIf(process.platform === 'win32')(
  'an escaping symlink never enters tracked bundle files',
  async () => {
    await withCourseRoot(async (root, parent) => {
      const owner = join(root, 'course.json')
      const outside = join(parent, 'outside.md')
      const tracked = new Set<string>()
      await writeFile(outside, 'Outside')
      await symlink(outside, join(root, 'link.md'))
      await expect(resolveReference(owner, 'link.md', root, tracked)).rejects.toMatchObject({
        diagnostic: { code: 'invalid-reference', file: owner },
      })
      expect(tracked.size).toBe(0)
    })
  },
)
