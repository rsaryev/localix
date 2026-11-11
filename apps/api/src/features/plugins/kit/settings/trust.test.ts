import { describe, expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { contentApplies, folderTrust, stampedTrust, trustSourceOf } from './trust'
import { sessionTrust } from '../sessions'
import { settingsFixture } from './testing/settings-fixture'

/**
 * Claude Code's workspace trust of a folder as the kit judges it (permissions.md, "Project allow
 * rules and workspace trust", "What runs before you trust a folder"; `workspaceTrustSituation`,
 * `contentGate`): the state file's answer for the key, a parent folder's outside a repository, and
 * what each kind of repository content does in that column.
 */

const read = settingsFixture('kit-trust-')
const scratch = tempDirPerTest('kit-trust-repo-')

describe('folderTrust', () => {
  test('the dialog accepted for the folder is trusted, for a folder above it parent-trusted', () => {
    expect(read({ trusted: true }).trust.situation).toBe('trusted')
    expect(read({ trusted: 'parent' }).trust.situation).toBe('parent-trusted')
    expect(read({}).trust.situation).toBe('dialog')
  })

  test('a repository is keyed on its root and a folder above it does not cover it', () => {
    const root = scratch()
    const repo = join(root, 'repo')
    mkdirSync(join(repo, '.git', 'objects'), { recursive: true })
    writeTree(repo, { '.git/HEAD': 'ref: refs/heads/main\n', 'src/.keep': '' })
    const state = (key: string) =>
      writeTree(root, {
        'home/.claude.json': JSON.stringify({
          projects: { [key]: { hasTrustDialogAccepted: true } },
        }),
      })
    const facts = { homeDir: join(root, 'home'), cwd: join(repo, 'src'), env: {} }
    state(root)
    expect(folderTrust(facts)).toEqual({ situation: 'dialog', key: repo })
    state(repo)
    expect(folderTrust(facts)).toEqual({ situation: 'trusted', key: repo })
  })
})

describe('contentApplies', () => {
  test('a parent folder trust runs settings hooks and env, never allow rules or a subagent hook', () => {
    const parent = read({ trusted: 'parent' }).trust.situation
    expect(contentApplies('settings-hooks', parent)).toBe(true)
    expect(contentApplies('env-and-helper-commands', parent)).toBe(true)
    for (const content of [
      'allow-rules',
      'subagent-frontmatter-hooks',
      'subagent-inline-mcp',
      'extra-known-marketplaces',
      'headers-helper',
    ] as const)
      expect(contentApplies(content, parent)).toBe(false)
  })
})

describe('the trust a consumer is handed', () => {
  test('a session runs settings-file hooks under a parent’s trust, project agent hooks only under its own', () => {
    expect(sessionTrust('trusted')).toEqual({ trusted: true, folderTrustAccepted: true })
    expect(sessionTrust('parent-trusted')).toEqual({ trusted: true, folderTrustAccepted: false })
    expect(sessionTrust('dialog')).toEqual({ trusted: false, folderTrustAccepted: false })
  })

  test('a server record carries the source its helper gate reads; a missing or odd stamp is none', () => {
    expect(trustSourceOf('trusted')).toBe('persisted')
    expect(trustSourceOf('parent-trusted')).toBe('parent-folder')
    expect(trustSourceOf('dialog')).toBe('none')
    expect(stampedTrust({ source: 'persisted', key: '/k' }, '/cwd')).toEqual({
      source: 'persisted',
      key: '/k',
    })
    for (const odd of [
      undefined,
      'persisted',
      { source: 'trusted', key: '/k' },
      { source: 'persisted' },
    ])
      expect(stampedTrust(odd, '/cwd')).toEqual({ source: 'none', key: '/cwd' })
  })
})
