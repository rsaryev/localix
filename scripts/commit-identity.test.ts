import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { checkCommitIdentity, identityProblem } from './commit-identity.mjs'
import { scratchGitEnv } from './scratch-git-env.mjs'

describe('commit identity guard', () => {
  test('accepts a real identity', () => {
    expect(identityProblem('rsaryev <rsaryev@yahoo.com> 1700000000 +0300')).toBeNull()
  })

  test('refuses the leaked fixture identity and other scratch domains', () => {
    for (const email of ['stamp@example.invalid', 'a@b.test', 'a@b.example', 'a@localhost']) {
      expect(identityProblem(`stamp <${email}> 1700000000 +0000`)).toContain('scratch identity')
    }
  })

  test('refuses an incomplete identity', () => {
    expect(identityProblem('<> 1700000000 +0000')).toContain('incomplete')
    expect(identityProblem('nobody <nobody@> 1700000000 +0000')).toContain('incomplete')
  })

  test('judges what git would record, from the environment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'localix-identity-'))
    try {
      const env = scratchGitEnv(process.env, { GIT_AUTHOR_EMAIL: 'stamp@example.invalid' })
      execFileSync('git', ['init', '-q'], { cwd: dir, env, timeout: 10_000, killSignal: 'SIGKILL' })
      const previous = process.cwd()
      process.chdir(dir)
      try {
        expect(checkCommitIdentity(env)).toEqual([
          'author: scratch identity Localix test <stamp@example.invalid>',
          'committer: scratch identity Localix test <test@localix.invalid>',
        ])
        expect(
          checkCommitIdentity({
            ...env,
            GIT_AUTHOR_EMAIL: 'me@example.com',
            GIT_COMMITTER_EMAIL: 'me@example.com',
          }),
        ).toEqual([])
      } finally {
        process.chdir(previous)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the hook runs the guard first', async () => {
    const hook = await Bun.file(resolve(import.meta.dir, '../.githooks/pre-commit')).text()
    expect(hook.indexOf('commit-identity.mjs')).toBeGreaterThan(-1)
    expect(hook.indexOf('commit-identity.mjs')).toBeLessThan(hook.indexOf('pre-commit.mjs'))
  })
})

describe('test git environment', () => {
  test('no test process inherits a hook GIT_* variable', () => {
    expect(Object.keys(process.env).filter((key) => key.startsWith('GIT_'))).toEqual([])
  })
})
