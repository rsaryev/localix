import { describe, expect, it } from 'bun:test'
import { createRepoWorkspaceService } from './service'
import type { ReadEntries } from './discovery'
import type { SourceControlBackend } from '../ports'
import type { RepoStatus } from '../contracts'

/** Virtual FS: container `/w` holds two sibling repos. */
const readEntries: ReadEntries = async (dir) => {
  const tree: Record<string, string[]> = {
    '/w': ['api', 'ui'],
    '/w/api': ['.git'],
    '/w/ui': ['.git'],
  }
  const names = tree[dir]
  if (!names) throw new Error('ENOENT')
  return names.map((name) => ({ name, isDirectory: !name.startsWith('.git') }))
}

const emptyStatus = (root: string): RepoStatus => ({
  root,
  branch: 'main',
  detached: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  files: [],
  stats: { files: 0, insertions: 0, deletions: 0 },
})

/** A backend whose getStatus just echoes the cwd as root; other methods unused here. */
const fakeBackend = (): SourceControlBackend =>
  ({
    id: 'git',
    getStatus: async (cwd: string) => emptyStatus(cwd),
  }) as unknown as SourceControlBackend

function make(scanRoot: string | null) {
  return createRepoWorkspaceService({
    resolveScanRoot: async () => scanRoot,
    backend: fakeBackend(),
    discoverOptions: { readEntries },
  })
}

describe('RepoWorkspaceService', () => {
  it('lists each discovered repo with status + relative name', async () => {
    const rows = await make('/w').listRepoStatuses('u', 's')
    expect(rows.map((r) => r.root)).toEqual(['/w/api', '/w/ui'])
    expect(rows.map((r) => r.name)).toEqual(['api', 'ui'])
    expect(rows.every((r) => r.status.isRepo && r.status.vcs === 'git')).toBe(true)
    // Container is not itself a repo → no primary.
    expect(rows.some((r) => r.isPrimary)).toBe(false)
  })

  it('marks the scan root itself as primary when it is a repo', async () => {
    const svc = createRepoWorkspaceService({
      resolveScanRoot: async () => '/w/api',
      backend: fakeBackend(),
      discoverOptions: { readEntries },
    })
    const rows = await svc.listRepoStatuses('u', 's')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.isPrimary).toBe(true)
    expect(rows[0]!.name).toBe('api') // basename when rel === ''
  })

  it('resolveRepoCwd returns a valid discovered repo', async () => {
    expect(await make('/w').resolveRepoCwd('u', 's', '/w/ui')).toBe('/w/ui')
  })

  it('resolveRepoCwd fails closed for an unknown/forged explicit path', async () => {
    expect(await make('/w').resolveRepoCwd('u', 's', '/etc/passwd')).toBeNull()
    expect(await make('/w').resolveRepoCwd('u', 's', '/w/nope')).toBeNull()
  })

  it('resolveRepoCwd returns the scan root when no repoRoot is given', async () => {
    expect(await make('/w').resolveRepoCwd('u', 's')).toBe('/w')
  })

  it('returns empty / null when the session has no working dir', async () => {
    expect(await make(null).listRepoStatuses('u', 's')).toEqual([])
    expect(await make(null).resolveRepoCwd('u', 's', '/w/api')).toBeNull()
  })
})
