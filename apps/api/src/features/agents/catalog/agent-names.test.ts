import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { parseAgentFile } from '../../plugins/discovery-cc-files'
import { recordOf } from '../projection'
import { agentFolders, scanAgents } from './scan'

// sub-agents.md, `name`: "at most 256 characters ... can't contain `:`"; a file whose name starts
// with `-`, contains `:` or is longer than 256 characters is skipped. No character class is
// documented, so a name like `Code Reviewer` is valid there. A skill list preloads "up to the
// first 32 distinct names"; agents have no `when_to_use` field.
describe('agent names and fields as Claude Code reads them', () => {
  const base = tempDirPerTest('agent-names-')
  const file = async (path: string, text: string) => {
    await fs.mkdir(join(path, '..'), { recursive: true })
    await fs.writeFile(path, text)
    return path
  }
  const agent = (name: string, extra = '') =>
    `---\nname: ${JSON.stringify(name)}\ndescription: does things\n${extra}---\nYou help.`
  const scan = async () =>
    scanAgents({
      folders: await agentFolders({
        cwd: join(base(), 'repo'),
        home: join(base(), 'home'),
        managedDir: join(base(), 'managed'),
      }),
      projectId: 'p',
      plugins: [],
    })

  test('a user agent with spaces, dots or capitals loads under the name it declares', async () => {
    const dir = join(base(), 'home', '.claude', 'agents')
    await file(join(dir, 'a.md'), agent('Code Reviewer'))
    await file(join(dir, 'b.md'), agent('reviewer.v2'))
    await file(join(dir, 'c.md'), agent('Ünïcode Tëster'))
    const catalog = await scan()
    const loaded = catalog.active.filter((a) => a.source === 'user')
    expect(loaded.map((a) => a.fullName).sort()).toEqual([
      'Code Reviewer',
      'reviewer.v2',
      'Ünïcode Tëster',
    ])
    // The name the file declares reaches it (a skill's `agent:`, an `Agent(...)` rule).
    expect(catalog.resolve('Code Reviewer')).toMatchObject({ agent: { fullName: 'Code Reviewer' } })
    expect(catalog.resolve('reviewer.v2')).toMatchObject({ agent: { fullName: 'reviewer.v2' } })
  })

  test('a name with no letters or digits, or the longest allowed, is kept as written', async () => {
    const dir = join(base(), 'home', '.claude', 'agents')
    await file(join(dir, 'a.md'), agent('日本語'))
    await file(join(dir, 'b.md'), agent('x'.repeat(256)))
    const loaded = (await scan()).active.filter((a) => a.source === 'user')
    expect(loaded).toHaveLength(2)
    expect(loaded.map((a) => a.fullName).sort()).toEqual(['x'.repeat(256), '日本語'].sort())
  })

  test('only a leading hyphen, a colon or more than 256 characters skips the file', async () => {
    const dir = join(base(), 'home', '.claude', 'agents')
    await file(join(dir, 'lead.md'), agent('-lead'))
    await file(join(dir, 'colon.md'), agent('a:b'))
    await file(join(dir, 'long.md'), agent('y'.repeat(257)))
    await file(join(dir, 'ok.md'), agent('fine_name-2'))
    const loaded = (await scan()).active.filter((a) => a.source === 'user')
    expect(loaded.map((a) => a.fullName)).toEqual(['fine_name-2'])
  })

  test('a plugin agent whose name is not usable loads under its file name', async () => {
    const dir = join(base(), 'plugin')
    const bad = await file(join(dir, 'helper.md'), agent('-bad'))
    const spaced = await file(join(dir, 'my agent.md'), '---\ndescription: x\n---\nBody')
    expect((await parseAgentFile(bad))?.name).toBe('helper')
    expect((await parseAgentFile(spaced))?.name).toBe('my agent')
  })

  test('an agent has no when_to_use: its description is the description alone', async () => {
    const path = await file(
      join(base(), 'plugin', 'a.md'),
      '---\nname: a\ndescription: Reviews code.\nwhen_to_use: Use on every PR.\nwhen-to-use: Also here.\n---\nBody',
    )
    expect((await parseAgentFile(path))?.description).toBe('Reviews code.')
  })

  test('only the first 32 distinct preloaded skills are kept', async () => {
    const names = Array.from({ length: 40 }, (_, i) => `skill-${i % 36}`)
    const path = await file(
      join(base(), 'plugin', 's.md'),
      `---\nname: s\ndescription: x\nskills: ${names.join(', ')}\n---\nBody`,
    )
    const parsed = await parseAgentFile(path)
    const kept = parsed?.pinnedSkills ?? []
    expect(kept).toHaveLength(32)
    expect(new Set(kept).size).toBe(32)
    expect(kept[0]).toBe('skill-0')
    expect(kept[31]).toBe('skill-31')
  })

  test('a record built from a catalog agent preloads at most 32 distinct skills', async () => {
    const dir = join(base(), 'home', '.claude', 'agents')
    const names = Array.from({ length: 45 }, (_, i) => `s${i}`)
    await file(join(dir, 'a.md'), agent('many', `skills: [${[...names, 's0'].join(', ')}]\n`))
    const found = (await scan()).active.find((a) => a.fullName === 'many')!
    const record = recordOf(found, 'id-1')
    expect(record.skills).toHaveLength(32)
  })
})
