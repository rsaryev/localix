import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import type { LoadedPluginAgent } from '../../plugins/loader-contract'
import { agentFolders, scanAgents } from './scan'

// sub-agents.md, "Choose the subagent scope": managed over project (walking up from the working
// directory to the repository root, the closest winning) over user over plugin; identity comes
// only from `name`; a file without a `name` or a `description` is documentation.
describe('the agent catalog', () => {
  const base = tempDirPerTest('agent-catalog-')
  const agent = (name: string, description: string, extra = '') =>
    `---\nname: ${name}\ndescription: ${description}\n${extra}---\nYou are ${name}.`
  const write = async (path: string, text: string) => {
    await fs.mkdir(join(path, '..'), { recursive: true })
    await fs.writeFile(path, text)
  }
  const pluginAgent = (plugin: string, name: string): LoadedPluginAgent => ({
    pluginName: plugin,
    name,
    fullName: `${plugin}:${name}`,
    label: name,
    description: `${name} from ${plugin}`,
    prompt: `You are ${plugin}:${name}.`,
  })
  const scan = async (cwd: string, plugins: LoadedPluginAgent[] = []) =>
    scanAgents({
      folders: await agentFolders({
        cwd,
        home: join(base(), 'home'),
        managedDir: join(base(), 'managed'),
      }),
      projectId: 'p',
      plugins,
    })

  test('precedence is managed, closest project, user, plugin, built in; shadowed ones stay listed', async () => {
    const home = join(base(), 'home')
    const repo = join(base(), 'repo')
    const pkg = join(repo, 'packages', 'web')
    await fs.mkdir(join(repo, '.git'), { recursive: true })
    await fs.mkdir(pkg, { recursive: true })
    await write(
      join(repo, '.claude', 'agents', 'review', 'reviewer.md'),
      agent('reviewer', 'root reviewer', 'tools: Read, Grep\nmodel: haiku\n'),
    )
    await write(join(pkg, '.claude', 'agents', 'reviewer.md'), agent('reviewer', 'web reviewer'))
    await write(join(home, '.claude', 'agents', 'helper.md'), agent('helper', 'my helper'))
    await write(join(home, '.claude', 'agents', 'reviewer.md'), agent('reviewer', 'user reviewer'))
    await write(join(base(), 'managed', '.claude', 'agents', 'helper.md'), agent('helper', 'org'))
    await write(join(repo, '.claude', 'agents', 'notes.md'), '# Just notes')
    await write(join(repo, '.claude', 'agents', 'nodesc.md'), '---\nname: nodesc\n---\nBody.')

    const catalog = await scan(pkg)
    const files = catalog.active.filter((a) => a.source !== 'builtin')
    expect(files.map((a) => [a.fullName, a.source, a.description])).toEqual([
      ['helper', 'managed', 'org'],
      ['reviewer', 'project', 'web reviewer'],
    ])
    const all = catalog.all.filter((a) => a.name === 'reviewer')
    expect(all.map((a) => a.description)).toEqual([
      'web reviewer',
      'root reviewer',
      'user reviewer',
    ])
    expect(catalog.shadowedBy(all[2]!)?.description).toBe('web reviewer')

    const root = await scan(repo)
    expect(root.resolve('reviewer')).toMatchObject({
      agent: { description: 'root reviewer', tools: ['Read', 'Search'] },
    })
  })

  test('reads no model, effort or localix key from a file', async () => {
    const repo = join(base(), 'repo')
    await write(
      join(repo, '.claude', 'agents', 'a.md'),
      agent('a', 'A', 'model: haiku\neffort: high\nlocalix:\n  model: openai/gpt-5\n'),
    )
    const found = (await scan(repo)).resolve('a')
    expect(found).toMatchObject({ agent: { description: 'A' } })
    for (const key of ['preferredModel', 'preferredEffort', 'localix'])
      expect(found).not.toHaveProperty(`agent.${key}`)
  })

  test('built-in types are entries a file of the same name replaces', async () => {
    const repo = join(base(), 'repo')
    await write(join(repo, '.claude', 'agents', 'explore.md'), agent('Explore', 'mine'))
    const catalog = await scan(repo)
    expect(catalog.resolve('Explore')).toMatchObject({ agent: { source: 'project' } })
    expect(catalog.resolve('Plan')).toMatchObject({ agent: { source: 'builtin' } })
  })

  test('resolve takes the one name a person types and refuses a guess between several', async () => {
    const repo = join(base(), 'repo')
    await write(join(repo, '.claude', 'agents', 'reviewer.md'), agent('reviewer', 'mine'))
    const catalog = await scan(repo, [
      pluginAgent('acme', 'architect'),
      pluginAgent('acme', 'shared'),
      pluginAgent('other', 'shared'),
    ])
    const named = (reference: string) => {
      const found = catalog.resolve(reference)
      return found && 'agent' in found ? found.agent.fullName : found
    }
    expect(named('reviewer')).toBe('reviewer')
    expect(named('Reviewer')).toBe('reviewer')
    expect(named('@reviewer')).toBeNull()
    expect(named('@agent-reviewer')).toBe('reviewer')
    expect(named('acme:architect')).toBe('acme:architect')
    expect(named('architect')).toBe('acme:architect')
    expect(named('shared')).toEqual({ ambiguous: ['acme:shared', 'other:shared'] })
    expect(named('nobody')).toBeNull()
    expect(named('   ')).toBeNull()
  })

  test('a project outside a repository reads its own folder only, not its parents', async () => {
    const outer = join(base(), 'outer')
    const inner = join(outer, 'inner')
    await write(join(outer, '.claude', 'agents', 'up.md'), agent('up', 'parent'))
    await write(join(inner, '.claude', 'agents', 'here.md'), agent('here', 'own'))
    const catalog = await scan(inner)
    expect(catalog.resolve('here')).not.toBeNull()
    expect(catalog.resolve('up')).toBeNull()
  })
})
