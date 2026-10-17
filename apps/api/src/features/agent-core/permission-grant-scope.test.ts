import { describe, expect, test } from 'bun:test'

import {
  describeGrantRule,
  grantCoversCall,
  programGrant,
  resourceGrant,
  type GrantCall,
} from './permission-grant-scope'

describe('what a shell approval remembers', () => {
  test('a command is remembered by its program, not by the tool', () => {
    // The defect this closes: keyed by tool name, a card showing `ls` covered `rm -rf` for
    // the rest of the session.
    expect(programGrant('bash', 'git status')).toMatchObject({
      scope: 'bash(git)',
      kind: 'program',
      label: 'git',
      covers: 'every git command',
      rule: { action: 'tool:bash', resource: 'git *' },
    })
  })

  test('a path is stripped so one program is one scope', () => {
    expect(programGrant('bash', '/usr/bin/git status')?.scope).toBe('bash(git)')
  })

  test('an interpreter is never granted', () => {
    // `bash(bash)` would cover `bash -c '<anything>'` — the blanket permission being removed.
    for (const command of ['bash deploy.sh', 'sh -c ls', 'python3 x.py', 'node build.js']) {
      expect(programGrant('bash', command)).toBeUndefined()
    }
  })

  test('a wrapper is never granted either', () => {
    // The scope would name the wrapper and say nothing about what actually runs.
    for (const command of [
      'sudo systemctl restart x',
      'xargs rm',
      'env FOO=1 ls',
      'timeout 5 ls',
    ]) {
      expect(programGrant('bash', command)).toBeUndefined()
    }
  })

  test('a chained line or a substitution reduces to no single program', () => {
    expect(programGrant('bash', 'git status && npm test')).toBeUndefined()
    expect(programGrant('bash', '$(cat cmd) run')).toBeUndefined()
  })
})

describe('what a resource approval remembers', () => {
  test('one declared resource is remembered exactly', () => {
    expect(resourceGrant('mcp_call', ['github/create_pr'])).toMatchObject({
      scope: 'mcp_call(github/create_pr)',
      rule: { action: 'tool:mcp_call', resource: 'github/create_pr' },
    })
  })

  test('a call that names nothing is granted the tool for the session, never as a rule', () => {
    // One click must not make a whole tool unprompted forever.
    const grant = resourceGrant('delegate', [])
    expect(grant).toMatchObject({ scope: 'delegate', kind: 'tool' })
    expect(grant?.rule).toBeUndefined()
  })

  test('several resources, or one spelled with glob syntax, are not reduced to a grant', () => {
    expect(resourceGrant('mcp_call', ['a', 'b'])).toBeUndefined()
    expect(resourceGrant('mcp_call', ['github/*'])).toBeUndefined()
  })
})

describe('what a remembered scope covers', () => {
  const bash = (command: string): GrantCall => ({ toolName: 'bash', subject: 'command', command })
  const read = (...targets: string[]): GrantCall => ({
    toolName: 'read',
    subject: 'path',
    command: targets.join('\n'),
    targets,
  })

  test('the same program, with any arguments — and never a different one', () => {
    expect(grantCoversCall('bash(git)', bash('git commit -m x'))).toBe(true)
    expect(grantCoversCall('bash(git)', bash('curl http://example.com'))).toBe(false)
    // Not by prefix-of-a-word either: `gitleaks` is not `git`.
    expect(grantCoversCall('bash(git)', bash('gitleaks detect'))).toBe(false)
  })

  test('every command in a chained line must be covered', () => {
    expect(grantCoversCall('bash(git)', bash('git status && git log'))).toBe(true)
    expect(grantCoversCall('bash(git)', bash('git status && rm -rf /tmp/x'))).toBe(false)
    expect(grantCoversCall('bash(git)', bash('git $(cat /tmp/x)'))).toBe(false)
  })

  test('a folder covers anything below it, and nothing beside it', () => {
    const folder = 'read(/work/other/src/*)'
    expect(grantCoversCall(folder, read('/work/other/src/hooks/useTheme.ts'))).toBe(true)
    expect(grantCoversCall(folder, read('/work/other/src/a.ts', '/work/other/src/b/c.ts'))).toBe(
      true,
    )
    expect(grantCoversCall(folder, read('/work/other/srcevil/a.ts'))).toBe(false)
    expect(grantCoversCall(folder, read('/work/other/src/a.ts', '/work/secret.ts'))).toBe(false)
  })

  test('an exact path covers that path only', () => {
    expect(grantCoversCall('read(/work/a.ts)', read('/work/a.ts'))).toBe(true)
    expect(grantCoversCall('read(/work/a.ts)', read('/work/a.tsx'))).toBe(false)
  })

  test('a folder never covers a credential inside it', () => {
    // The same carve-out a dangerous command gets: granting a project's sources must not
    // start handing its `.env` to the model.
    expect(grantCoversCall('read(/work/other/*)', read('/work/other/.env'))).toBe(false)
  })

  test('the defect this replaced: a path is never read as a program', () => {
    // A file card used to grant `read(useTheme.ts)` and match it as `useTheme.ts *` — which
    // no absolute path can ever match. Now a program scope simply does not cover a path.
    expect(grantCoversCall('read(useTheme.ts)', read('/work/useTheme.ts'))).toBe(false)
    expect(grantCoversCall('read(/work/*)', bash('/work/x'))).toBe(false)
  })

  test('a scope from one tool does not cover another', () => {
    expect(grantCoversCall('read(/work/*)', { ...read('/work/a.ts'), toolName: 'write' })).toBe(
      false,
    )
  })

  test('a bare tool-name scope never starts covering a call that names something', () => {
    const bare: GrantCall = { toolName: 'delegate', subject: 'resource', targets: [] }
    expect(grantCoversCall('delegate', bare)).toBe(true)
    expect(grantCoversCall('delegate', { ...bare, targets: ['builtin:qa'] })).toBe(false)
    expect(grantCoversCall('bash', bash('ls'))).toBe(false)
  })
})

test('a rule is described in the spelling Settings shows', () => {
  expect(describeGrantRule({ action: 'tool:read', resource: '/work/src/*' })).toBe(
    'read(/work/src/*)',
  )
})
