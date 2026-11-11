import { describe, expect, test } from 'bun:test'

import { pluginVersion } from './kit'
import { kitEntry } from './kit/testing'

import { entryVersionInput, RELATIVE_INPUT, withCommit } from './plugin-version'

const SHA = '0123456789abcdef0123456789abcdef01234567'
const BASE = { inGitRepository: false, enclosingRepoIgnored: false }

describe('what a marketplace entry says about its version before anything is fetched', () => {
  test('a pinned sha is the version source and never moves', () => {
    expect(
      entryVersionInput(
        kitEntry({ name: 'p', source: { source: 'github', repo: 'o/r', sha: SHA } }),
      ),
    ).toEqual({ ...BASE, sourceKind: 'github', commitSha: SHA })
  })

  test('a relative entry, an npm entry and an archive entry', () => {
    expect(entryVersionInput(kitEntry({ name: 'p', source: './plugins/p' }))).toEqual(
      RELATIVE_INPUT,
    )
    expect(
      entryVersionInput(kitEntry({ name: 'p', source: { source: 'npm', package: 'x' } })),
    ).toEqual({ ...BASE, sourceKind: 'npm' })
    expect(
      entryVersionInput(
        kitEntry({
          name: 'p',
          source: { source: 'archive', url: 'https://x.example/p.zip', sha256: 'ab'.repeat(32) },
        }),
      ),
    ).toEqual({ ...BASE, sourceKind: 'archive', archiveSha256: 'ab'.repeat(32) })
  })

  test('a command entry is a command source, whatever its entry version', () => {
    expect(
      entryVersionInput(kitEntry({ name: 'p', source: { source: 'command', command: 'echo /x' } })),
    ).toEqual({ ...BASE, sourceKind: 'command' })
  })

  test('an unpinned git entry is a git source whose commit is not known yet', () => {
    expect(
      entryVersionInput(
        kitEntry({ name: 'p', source: { source: 'git-subdir', url: 'o/r', path: 'x' } }),
      ),
    ).toEqual({ ...BASE, sourceKind: 'git-subdir', subdir: 'x' })
  })

  test('a commit reaches a git or relative source only, and puts a relative one in git', () => {
    expect(withCommit(RELATIVE_INPUT, SHA)).toEqual({
      ...BASE,
      sourceKind: 'relative',
      inGitRepository: true,
      commitSha: SHA,
    })
    const npm = { ...BASE, sourceKind: 'npm' } as const
    expect(withCommit(npm, SHA)).toBe(npm)
    expect(withCommit(RELATIVE_INPUT, undefined)).toBe(RELATIVE_INPUT)
  })
})

test('a URL source is a url source and versions as a github one does, so no update appears', async () => {
  const url = entryVersionInput(
    kitEntry({ name: 'p', source: { source: 'url', url: 'https://github.com/o/r.git', sha: SHA } }),
  )
  const github = entryVersionInput(
    kitEntry({ name: 'p', source: { source: 'github', repo: 'o/r', sha: SHA } }),
  )
  expect(url.sourceKind).toBe('url')
  expect(await pluginVersion(url)).toBe(await pluginVersion(github))
  expect(await pluginVersion(url)).toBe(SHA.slice(0, 12))
})
