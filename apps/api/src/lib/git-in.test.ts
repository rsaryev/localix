import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { run, scratchGitEnv, tempDirPerTest } from '@localixai/testing'

import { gitIn } from './git-in'

const scratch = tempDirPerTest('git-in-')

describe('gitIn', () => {
  test('reads a repository of the folder, without trailing whitespace', async () => {
    const cwd = scratch()
    await run('git', ['init', '-q', cwd], { env: scratchGitEnv() })
    expect(await gitIn(cwd)(['rev-parse', '--is-inside-work-tree'])).toBe('true')
  })

  test('is null where git fails: no repository, a folder that is not there', async () => {
    const cwd = scratch()
    expect(await gitIn(join(cwd, 'nothing'))(['status'])).toBeNull()
    expect(await gitIn(cwd)(['rev-parse', '--is-inside-work-tree'])).toBeNull()
  })

  test('a GIT_DIR of the environment does not redirect it', async () => {
    const cwd = scratch()
    const previous = process.env.GIT_DIR
    process.env.GIT_DIR = join(cwd, 'elsewhere')
    try {
      expect(await gitIn(cwd)(['rev-parse', '--is-inside-work-tree'])).toBeNull()
    } finally {
      if (previous === undefined) delete process.env.GIT_DIR
      else process.env.GIT_DIR = previous
    }
  })
})
