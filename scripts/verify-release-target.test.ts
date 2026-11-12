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
      repository: 'localixai/localix-studio',
      tag: 'v1.2.3',
      sourceCommit: commit,
      request: requestFrom({
        '/repos/localixai/localix-studio/git/ref/tags/v1.2.3': {
          object: { type: 'tag', sha: tagObject },
        },
        [`/repos/localixai/localix-studio/git/tags/${tagObject}`]: {
          object: { type: 'commit', sha: commit },
        },
        // Only the list returns drafts; `releases/tags/{tag}` answers 404 for one.
        '/repos/localixai/localix-studio/releases?per_page=100': [
          { tag_name: 'v1.2.2', draft: false, body: 'older' },
          { tag_name: 'v1.2.3', draft: true, body: `Localix v1.2.3\n\nSource commit: ${commit}` },
        ],
      }),
    })

    expect(result).toEqual({ releaseExists: true })
  })

  test('allows creation only when the exact tag exists and the release does not', () => {
    const result = inspectReleaseTarget({
      repository: 'localixai/localix-studio',
      tag: 'v1.2.3',
      sourceCommit: commit,
      request: requestFrom({
        '/repos/localixai/localix-studio/git/ref/tags/v1.2.3': {
          object: { type: 'commit', sha: commit },
        },
      }),
    })

    expect(result).toEqual({ releaseExists: false })
  })

  test('rejects a mismatched tag, a published release, and an unrelated draft', () => {
    const baseEntries = {
      '/repos/localixai/localix-studio/git/ref/tags/v1.2.3': {
        object: { type: 'commit', sha: commit },
      },
    }
    const inspect = (release?: unknown, sourceCommit = commit) =>
      inspectReleaseTarget({
        repository: 'localixai/localix-studio',
        tag: 'v1.2.3',
        sourceCommit,
        request: requestFrom({
          ...baseEntries,
          ...(release === undefined
            ? {}
            : {
                '/repos/localixai/localix-studio/releases?per_page=100': [
                  { tag_name: 'v1.2.3', ...release },
                ],
              }),
        }),
      })

    expect(() => inspect(undefined, 'c'.repeat(40))).toThrow('does not point to reviewed commit')
    expect(() => inspect({ draft: false, body: `Source commit: ${commit}` })).toThrow(
      'already published',
    )
    expect(() => inspect({ draft: true, body: 'another source' })).toThrow(
      'belongs to a different source commit',
    )
    // Another tag's draft in the list is not this release.
    expect(
      inspectReleaseTarget({
        repository: 'localixai/localix-studio',
        tag: 'v1.2.3',
        sourceCommit: commit,
        request: requestFrom({
          ...baseEntries,
          '/repos/localixai/localix-studio/releases?per_page=100': [
            { tag_name: 'v1.2.4', draft: true },
          ],
        }),
      }),
    ).toEqual({ releaseExists: false })
  })
})
