import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { declaredMarketplaces } from './declared'

/**
 * `extraKnownMarketplaces` as the kit plans it (`createMarketplaceRegistry`; settings-reference.md):
 * the highest-precedence entry for a name wins whole (user < project < local < managed), a project
 * or local entry counts only in a folder Claude Code trusts, and a source the managed allowlist or
 * blocklist does not let in is refused with the policy's message.
 */

const dir = tempDirPerTest('declared-plan-')
const CATALOG = '.claude-plugin/marketplace.json'
const github = (repo: string) => ({ kind: 'github' as const, repo, path: CATALOG })

function setup(trustProject: boolean) {
  const home = join(dir(), 'home')
  const project = join(dir(), 'project')
  writeTree(home, {
    '.claude/settings.json': JSON.stringify({
      extraKnownMarketplaces: {
        team: { source: { source: 'github', repo: 'user/team' }, autoUpdate: true },
        mine: { source: { source: 'github', repo: 'me/mine' } },
      },
    }),
    ...(trustProject
      ? {
          '.claude.json': JSON.stringify({
            projects: { [project]: { hasTrustDialogAccepted: true } },
          }),
        }
      : {}),
  })
  writeTree(project, {
    '.claude/settings.json': JSON.stringify({
      extraKnownMarketplaces: { team: { source: { source: 'github', repo: 'project/team' } } },
    }),
  })
  return { homeDir: home, cwd: project, env: {}, managedSettingsDir: join(dir(), 'managed') }
}

describe('declaredMarketplaces', () => {
  it('a project entry in a folder that is not trusted is ignored, as if absent', async () => {
    expect(await declaredMarketplaces(setup(false))).toEqual([
      { name: 'mine', source: github('me/mine'), from: 'user' },
      { name: 'team', source: github('user/team'), from: 'user', autoUpdate: true },
    ])
  })

  it('in a trusted folder the project entry wins whole, the user entry’s autoUpdate with it', async () => {
    expect(await declaredMarketplaces(setup(true))).toEqual([
      { name: 'mine', source: github('me/mine'), from: 'user' },
      { name: 'team', source: github('project/team'), from: 'project' },
    ])
  })

  it('a managed entry wins over every file, and a source the blocklist names is refused', async () => {
    const opts = setup(true)
    writeTree(opts.managedSettingsDir, {
      'managed-settings.json': JSON.stringify({
        extraKnownMarketplaces: {
          team: { source: { source: 'github', repo: 'org/team' }, autoUpdate: false },
        },
        blockedMarketplaces: [{ source: 'github', repo: 'me/mine' }],
      }),
    })
    const declared = await declaredMarketplaces(opts)
    expect(declared.find((one) => one.name === 'team')).toEqual({
      name: 'team',
      source: github('org/team'),
      from: 'managed',
      autoUpdate: false,
    })
    expect(declared.find((one) => one.name === 'mine')?.refused).toContain('me/mine')
  })
})
