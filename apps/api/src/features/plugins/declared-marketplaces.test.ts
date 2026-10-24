import { describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { declaredMarketplaces, registerDeclaredMarketplaces } from './declared-marketplaces'
import { readKnownMarketplaces } from './marketplace-registry'

/**
 * `extraKnownMarketplaces` (settings-reference.md): a marketplace a settings file declares is
 * registered without anyone adding it. Across files the highest-precedence entry wins whole
 * (user < project < local < managed), and its `autoUpdate` is kept.
 */

const dir = tempDirPerTest('declared-mkt-')
const catalog = (name: string) =>
  JSON.stringify({ name, owner: { name: 'Acme' }, plugins: [{ name: 'p', source: './p' }] })

describe('declared marketplaces', () => {
  it('reads every settings file, the highest-precedence entry winning whole', async () => {
    const home = join(dir(), 'home')
    const project = join(dir(), 'project')
    writeTree(home, {
      '.claude/settings.json': JSON.stringify({
        extraKnownMarketplaces: {
          team: { source: { source: 'github', repo: 'user/team' }, autoUpdate: true },
          mine: { source: { source: 'github', repo: 'me/mine' } },
        },
      }),
    })
    writeTree(project, {
      '.claude/settings.json': JSON.stringify({
        extraKnownMarketplaces: { team: { source: { source: 'github', repo: 'project/team' } } },
      }),
    })
    const declared = await declaredMarketplaces({
      homeDir: home,
      cwd: project,
      env: {},
      managedSettingsDir: join(dir(), 'none'),
    })
    expect(declared).toEqual([
      { name: 'mine', source: { source: 'github', repo: 'me/mine' }, from: 'user' },
      { name: 'team', source: { source: 'github', repo: 'project/team' }, from: 'project' },
    ])
  })

  it('registers what is not known yet, with its autoUpdate', async () => {
    writeTree(join(dir(), 'upstream'), {
      '.claude-plugin/marketplace.json': catalog('team'),
      'p/.claude-plugin/plugin.json': '{"name":"p"}',
    })
    const root = join(dir(), 'marketplaces')
    const deps = {
      root,
      cloneRepo: async (_url: string, dest: string) => {
        await fs.cp(join(dir(), 'upstream'), dest, { recursive: true })
      },
    }
    const declared = [
      {
        name: 'team',
        source: { source: 'github' as const, repo: 'acme/team' },
        from: 'user' as const,
        autoUpdate: true,
      },
    ]
    expect(await registerDeclaredMarketplaces(declared, deps)).toEqual({
      added: ['team'],
      warnings: [],
    })
    expect((await readKnownMarketplaces(root)).team).toMatchObject({ autoUpdate: true })
    // Known already: nothing is fetched again.
    expect(
      await registerDeclaredMarketplaces(declared, {
        ...deps,
        cloneRepo: async () => {
          throw new Error('not again')
        },
      }),
    ).toEqual({ added: [], warnings: [] })
  })
})
