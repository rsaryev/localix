import { kitEntry } from './kit/testing'
import { describe, expect, test } from 'bun:test'

import { entryVersionFacts } from './plugin-version'

const SHA = '0123456789abcdef0123456789abcdef01234567'

describe('what a marketplace entry says about its version before anything is fetched', () => {
  test('a pinned sha is the version source and never moves', () => {
    expect(
      entryVersionFacts(
        kitEntry({ name: 'p', source: { source: 'github', repo: 'o/r', sha: SHA } }),
      ),
    ).toEqual({ kind: 'git', commitSha: SHA, pinned: true })
  })

  test('a relative entry, an npm entry and an archive entry', () => {
    expect(entryVersionFacts(kitEntry({ name: 'p', source: './plugins/p' }))).toEqual({
      kind: 'relative',
    })
    expect(
      entryVersionFacts(kitEntry({ name: 'p', source: { source: 'npm', package: 'x' } })),
    ).toEqual({
      kind: 'npm',
    })
    expect(
      entryVersionFacts(
        kitEntry({
          name: 'p',
          source: { source: 'archive', url: 'https://x.example/p.zip', sha256: 'ab'.repeat(32) },
        }),
      ),
    ).toEqual({ kind: 'archive', sha256: 'ab'.repeat(32) })
  })

  test('a command entry is a command source, whatever its entry version', () => {
    expect(
      entryVersionFacts(kitEntry({ name: 'p', source: { source: 'command', command: 'echo /x' } })),
    ).toEqual({ kind: 'command' })
  })

  test('an unpinned git entry is a git source whose commit is not known yet', () => {
    expect(
      entryVersionFacts(
        kitEntry({ name: 'p', source: { source: 'git-subdir', url: 'o/r', path: 'x' } }),
      ),
    ).toEqual({ kind: 'git', subdir: 'x' })
  })
})
