import { describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { registerDeclaredMarketplaces } from './declared-marketplaces'
import { declaredMarketplaces, readKnownMarketplaces } from './kit'

/**
 * `extraKnownMarketplaces` (settings-reference.md): a marketplace a settings file declares is
 * registered without anyone adding it, with its `autoUpdate`. Which entry wins is the kit's plan
 * (`kit/marketplace/declared.test.ts`).
 */

const dir = tempDirPerTest('declared-mkt-')
const CATALOG = '.claude-plugin/marketplace.json'
const catalog = (name: string) =>
  JSON.stringify({ name, owner: { name: 'Acme' }, plugins: [{ name: 'p', source: './p' }] })

describe('declared marketplaces', () => {
  it('a source the managed policy refuses is not fetched; its refusal is a warning', async () => {
    const deps = {
      root: join(dir(), 'marketplaces'),
      cloneRepo: async () => {
        throw new Error('a refused source is not cloned')
      },
    }
    const declared = [
      {
        name: 'team',
        source: { kind: 'github' as const, repo: 'acme/team', path: CATALOG },
        from: 'user' as const,
        refused: 'blocked by policy',
      },
    ]
    expect(await registerDeclaredMarketplaces(declared, deps)).toEqual({
      added: [],
      warnings: ['Marketplace "team" from user settings: blocked by policy'],
    })
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
        source: { kind: 'github' as const, repo: 'acme/team', path: CATALOG },
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

  it('registers an inline catalog once, from the settings that declare it', async () => {
    const home = join(dir(), 'home')
    const plugins = [{ name: 'p', source: { source: 'github', repo: 'acme/p' } }]
    writeTree(home, {
      '.claude/settings.json': JSON.stringify({
        extraKnownMarketplaces: { team: { source: { source: 'settings', name: 'team', plugins } } },
      }),
    })
    const opts = { homeDir: home, cwd: null, env: {}, managedSettingsDir: join(dir(), 'none') }
    const deps = {
      root: join(dir(), 'marketplaces'),
      cloneRepo: async () => {
        throw new Error('an inline catalog is not cloned')
      },
    }
    const declared = await declaredMarketplaces(opts)
    expect(await registerDeclaredMarketplaces(declared, deps)).toEqual({
      added: ['team'],
      warnings: [],
    })
    expect(await registerDeclaredMarketplaces(declared, deps)).toEqual({ added: [], warnings: [] })
    const catalogFile = join(deps.root, 'team', CATALOG)
    expect(JSON.parse(await fs.readFile(catalogFile, 'utf8'))).toMatchObject({
      name: 'team',
      plugins,
    })
  })
})
