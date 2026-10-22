import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import type { MarketplaceEntry } from './marketplace'
import { resolveEntrySource } from './marketplace-entry-source'
import { gitRefProblem, gitUrlProblem } from './marketplace-git-args'
import { fetchEntryPlugin, materializeMarketplace } from './marketplace-materialize'
import type { MarketplaceRegistryDeps } from './marketplace-registry'

/**
 * Marketplace git coordinates reach `git` only in the forms a git source documents: a catalog
 * cannot smuggle an option (`--upload-pack=…`) or a command transport (`ext::sh -c …`) through a
 * plugin entry's `url`, `ref` or `sha`, nor through a marketplace source.
 */

const dir = tempDirPerTest('mkt-gitargs')
const entry = (source: Record<string, unknown>) => ({ name: 'p', source }) as MarketplaceEntry

describe('gitUrlProblem', () => {
  it('accepts https, http, ssh, file and scp-style URLs', () => {
    for (const url of [
      'https://github.com/o/r.git',
      'http://git.lan/o/r',
      'ssh://git@host:22/o/r.git',
      'file:///srv/git/r.git',
      'git@github.com:o/r.git',
      'deploy.bot@git.example.com:team/r',
    ])
      expect(gitUrlProblem(url)).toBeNull()
  })

  it('refuses options, remote-helper transports and other schemes', () => {
    expect(gitUrlProblem('--upload-pack=touch /tmp/x')).toContain('starts with "-"')
    expect(gitUrlProblem('ext::sh -c touch% /tmp/x')).toContain('remote helper')
    expect(gitUrlProblem('fd::17')).toContain('remote helper')
    expect(gitUrlProblem('-oProxyCommand=x@host:path')).toContain('starts with "-"')
    expect(gitUrlProblem('ftp://host/r.git')).toContain('must be')
    expect(gitUrlProblem('/local/path')).toContain('must be')
    expect(gitUrlProblem('https://host/r\n.git')).toContain('control character')
  })

  it('refuses refs git would read as options or that are not refs', () => {
    expect(gitRefProblem('v1.2.0')).toBeNull()
    expect(gitRefProblem('refs/heads/main')).toBeNull()
    expect(gitRefProblem('a1b2c3d4')).toBeNull()
    expect(gitRefProblem('--upload-pack=touch /tmp/x')).toContain('starts with "-"')
    expect(gitRefProblem('main:refs/heads/x')).toContain('not a valid')
  })
})

describe('marketplace git sources', () => {
  it('a plugin entry with an option-shaped or ext:: url, or an option-shaped ref, is refused', () => {
    for (const source of [
      { source: 'url', url: '--upload-pack=touch /tmp/pwned' },
      { source: 'url', url: 'ext::sh -c touch% /tmp/pwned' },
      { source: 'git-subdir', url: '--template=/tmp', path: 'p' },
      { source: 'url', url: 'https://github.com/o/r.git', ref: '--upload-pack=touch /tmp/pwned' },
      { source: 'github', repo: 'o/r', sha: '-c' },
    ])
      expect(() => resolveEntrySource('/m', entry(source))).toThrow('Entry "p" source')
  })

  it('never calls git for unsafe coordinates of a marketplace or a fetched entry', async () => {
    const cloned: string[] = []
    const deps: MarketplaceRegistryDeps = {
      cloneRepo: async (url) => {
        cloned.push(url)
      },
    }
    await expect(
      materializeMarketplace(
        { source: 'git', url: '-oProxyCommand=x@h:p' },
        join(dir(), 's'),
        deps,
      ),
    ).rejects.toThrow('Marketplace source')
    await expect(
      materializeMarketplace(
        { source: 'github', repo: 'o/r', ref: '--upload-pack=x' },
        join(dir(), 's'),
        deps,
      ),
    ).rejects.toThrow('Marketplace source')
    await expect(
      fetchEntryPlugin({ git: { url: 'ext::sh -c x' } }, join(dir(), 'e'), deps),
    ).rejects.toThrow('Plugin source')
    expect(cloned).toEqual([])
  })
})
