import { describe, expect, test } from 'bun:test'

import { inspectReleaseTarget } from './verify-release-target.mjs'

const commit = 'a'.repeat(40)
const tagObject = 'b'.repeat(40)

function requestFrom(entries: Record<string, unknown>) {
  return (path: string) => entries[path] ?? null
}

describe('release target provenance', () => {
  test('accepts an exact annotated tag and a matching reusable draft', () => {
    const result = inspectReleaseTarget({
      repository: 'rsaryev/localix',
      tag: 'v1.2.3',
      sourceCommit: commit,
      request: requestFrom({
        '/repos/rsaryev/localix/git/ref/tags/v1.2.3': {
          object: { type: 'tag', sha: tagObject },
        },
        [`/repos/rsaryev/localix/git/tags/${tagObject}`]: {
          object: { type: 'commit', sha: commit },
        },
        '/repos/rsaryev/localix/releases/tags/v1.2.3': {
          draft: true,
          body: `Localix v1.2.3\n\nSource commit: ${commit}`,
        },
      }),
    })

    expect(result).toEqual({ releaseExists: true })
  })

  test('allows creation only when the exact tag exists and the release does not', () => {
    const result = inspectReleaseTarget({
      repository: 'rsaryev/localix',
      tag: 'v1.2.3',
      sourceCommit: commit,
      request: requestFrom({
        '/repos/rsaryev/localix/git/ref/tags/v1.2.3': {
          object: { type: 'commit', sha: commit },
        },
      }),
    })

    expect(result).toEqual({ releaseExists: false })
  })

  test('rejects a mismatched tag, a published release, and an unrelated draft', () => {
    const baseEntries = {
      '/repos/rsaryev/localix/git/ref/tags/v1.2.3': {
        object: { type: 'commit', sha: commit },
      },
    }
    const inspect = (release?: unknown, sourceCommit = commit) =>
      inspectReleaseTarget({
        repository: 'rsaryev/localix',
        tag: 'v1.2.3',
        sourceCommit,
        request: requestFrom({
          ...baseEntries,
          ...(release === undefined
            ? {}
            : { '/repos/rsaryev/localix/releases/tags/v1.2.3': release }),
        }),
      })

    expect(() => inspect(undefined, 'c'.repeat(40))).toThrow('does not point to reviewed commit')
    expect(() => inspect({ draft: false, body: `Source commit: ${commit}` })).toThrow(
      'already published',
    )
    expect(() => inspect({ draft: true, body: 'another source' })).toThrow(
      'belongs to a different source commit',
    )
  })
})
