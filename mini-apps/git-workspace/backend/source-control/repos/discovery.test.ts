import { describe, expect, it } from 'bun:test'
import { discoverRepos, type DirEntry, type ReadEntries } from './discovery'

/**
 * Build an injectable `readEntries` from a virtual tree. Keys are absolute dirs;
 * values are their child entry names. A child named `.git` marks a repo. A name
 * ending in `/` (stripped) is a subdirectory; anything else is a file.
 */
function fakeFs(tree: Record<string, string[]>): ReadEntries {
  return async (dir: string): Promise<DirEntry[]> => {
    const names = tree[dir]
    if (!names) throw new Error(`ENOENT ${dir}`)
    return names.map((raw) => {
      const isDir = raw.endsWith('/')
      const name = isDir ? raw.slice(0, -1) : raw
      return { name, isDirectory: isDir }
    })
  }
}

describe('discoverRepos', () => {
  it('finds sibling repos under a non-repo container', async () => {
    const read = fakeFs({
      '/w': ['repoA/', 'repoB/', 'readme.md'],
      '/w/repoA': ['.git', 'src/'],
      '/w/repoB': ['.git', 'index.js'],
    })
    expect(await discoverRepos('/w', { readEntries: read })).toEqual(['/w/repoA', '/w/repoB'])
  })

  it('does not descend into a found repo (ignores nested repos inside it)', async () => {
    const read = fakeFs({
      '/w': ['repoA/'],
      '/w/repoA': ['.git', 'node_modules/', 'sub/'],
      '/w/repoA/sub': ['.git'], // would be a nested repo, but repoA is a boundary
    })
    expect(await discoverRepos('/w', { readEntries: read })).toEqual(['/w/repoA'])
  })

  it('descends through the root even when it is itself a repo (surfaces nested repos)', async () => {
    // A container that is ALSO a repo (tracks its own files) holding sibling clones.
    const read = fakeFs({
      '/w': ['.git', 'child/'],
      '/w/child': ['.git'],
    })
    expect(await discoverRepos('/w', { readEntries: read })).toEqual(['/w', '/w/child'])
  })

  it('surfaces sibling clones under a subdir of a container-that-is-a-repo', async () => {
    // Mirrors a real workspace: the root is a git repo, with independent clones
    // several levels down under a (gitignored) container dir. The root is recorded
    // AND every nested clone is surfaced; a repo below the root is still a boundary.
    const read = fakeFs({
      '/w': ['.git', 'README.md', 'gitlab/'],
      '/w/gitlab': ['acme/'],
      '/w/gitlab/acme': ['billing/', 'modules/'],
      '/w/gitlab/acme/billing': ['.git', 'sub/'],
      '/w/gitlab/acme/billing/sub': ['.git'], // nested inside a found repo — NOT surfaced
      '/w/gitlab/acme/modules': ['widgets/'],
      '/w/gitlab/acme/modules/widgets': ['.git'],
    })
    expect(await discoverRepos('/w', { readEntries: read })).toEqual([
      '/w',
      '/w/gitlab/acme/billing',
      '/w/gitlab/acme/modules/widgets',
    ])
  })

  it('skips build/dependency and dot directories', async () => {
    const read = fakeFs({
      '/w': ['node_modules/', 'dist/', '.hidden/', 'app/'],
      '/w/node_modules': ['pkg/'],
      '/w/node_modules/pkg': ['.git'], // must never be found
      '/w/.hidden': ['.git'], // dot-dir never entered
      '/w/app': ['.git'],
    })
    expect(await discoverRepos('/w', { readEntries: read })).toEqual(['/w/app'])
  })

  it('honours maxDepth', async () => {
    const read = fakeFs({
      '/w': ['a/'],
      '/w/a': ['b/'],
      '/w/a/b': ['c/'],
      '/w/a/b/c': ['.git'],
    })
    expect(await discoverRepos('/w', { readEntries: read, maxDepth: 2 })).toEqual([])
    expect(await discoverRepos('/w', { readEntries: read, maxDepth: 3 })).toEqual(['/w/a/b/c'])
  })

  it('honours maxRepos cap', async () => {
    const read = fakeFs({
      '/w': ['r1/', 'r2/', 'r3/'],
      '/w/r1': ['.git'],
      '/w/r2': ['.git'],
      '/w/r3': ['.git'],
    })
    const out = await discoverRepos('/w', { readEntries: read, maxRepos: 2 })
    expect(out.length).toBe(2)
  })

  it('tolerates an unreadable root (returns empty)', async () => {
    const read: ReadEntries = async () => {
      throw new Error('EACCES')
    }
    expect(await discoverRepos('/nope', { readEntries: read })).toEqual([])
  })

  it('treats a `.git` FILE (worktree/submodule) as a repo root', async () => {
    const read = fakeFs({
      '/w': ['linked/'],
      '/w/linked': ['.git'], // file form is indistinguishable by name; still a repo
    })
    expect(await discoverRepos('/w', { readEntries: read })).toEqual(['/w/linked'])
  })
})
