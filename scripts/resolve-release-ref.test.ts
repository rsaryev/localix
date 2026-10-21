import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  assertReleaseCommitOnMain,
  parseReleaseTag,
  resolveReleaseCommit,
  selectReleaseTag,
} from './resolve-release-ref.mjs'
import { scratchGitEnv } from './scratch-git-env.mjs'

describe('release ref validation', () => {
  test('accepts stable and prerelease semantic versions', () => {
    expect(parseReleaseTag('v1.2.3')).toEqual({
      tag: 'v1.2.3',
      version: '1.2.3',
      isPrerelease: false,
    })
    expect(parseReleaseTag('v2.0.0-rc.1+build.7')).toEqual({
      tag: 'v2.0.0-rc.1+build.7',
      version: '2.0.0-rc.1+build.7',
      isPrerelease: true,
    })
    expect(parseReleaseTag('v1.2.3+build-7')).toEqual({
      tag: 'v1.2.3+build-7',
      version: '1.2.3+build-7',
      isPrerelease: false,
    })
  })

  test.each([
    '',
    '1.2.3',
    'v1.2',
    'v01.2.3',
    'v1.02.3',
    'v1.2.03',
    'v1.2.3-01',
    'v1.2.3\nmalicious=true',
    'v1.2.3; echo unsafe',
  ])('rejects unsafe or non-semantic tag %j', (tag) => {
    expect(() => parseReleaseTag(tag)).toThrow(
      'Release tag must be an exact semantic version such as v1.2.3',
    )
  })

  test('uses an explicit dispatch input and otherwise falls back to the event ref', () => {
    expect(selectReleaseTag('v3.1.4', 'main')).toBe('v3.1.4')
    expect(selectReleaseTag('', 'v3.1.5')).toBe('v3.1.5')
    expect(selectReleaseTag(undefined, 'v3.1.6')).toBe('v3.1.6')
  })

  test('peels an annotated tag to the exact source commit', () => {
    const repository = mkdtempSync(join(tmpdir(), 'localix-release-ref-'))
    const gitEnvironment = scratchGitEnv()
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: repository, env: gitEnvironment, encoding: 'utf8' }).trim()

    try {
      git('init', '--quiet', '--initial-branch=main')
      writeFileSync(join(repository, 'artifact.txt'), 'reviewed source\n')
      git('add', 'artifact.txt')
      git('commit', '--quiet', '-m', 'tagged source')
      const commit = git('rev-parse', 'HEAD')
      git('tag', '-a', 'v1.2.3', '-m', 'release v1.2.3')

      expect(resolveReleaseCommit('v1.2.3', repository, gitEnvironment)).toBe(commit)
      expect(() =>
        assertReleaseCommitOnMain(commit, repository, 'refs/heads/main', gitEnvironment),
      ).not.toThrow()

      git('switch', '--quiet', '-c', 'unreviewed-release')
      writeFileSync(join(repository, 'unreviewed.txt'), 'side branch only\n')
      git('add', 'unreviewed.txt')
      git('commit', '--quiet', '-m', 'unreviewed release source')
      const unreviewedCommit = git('rev-parse', 'HEAD')
      expect(() =>
        assertReleaseCommitOnMain(unreviewedCommit, repository, 'refs/heads/main', gitEnvironment),
      ).toThrow('Release tag commit must be reachable from refs/heads/main')

      expect(() => resolveReleaseCommit('v1.2.4', repository, gitEnvironment)).toThrow(
        'Release tag does not exist in this repository',
      )
    } finally {
      rmSync(repository, { recursive: true, force: true })
    }
  }, 15_000)
})
